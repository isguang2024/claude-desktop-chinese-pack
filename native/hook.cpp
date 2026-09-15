#include <windows.h>
#include <cwchar>
#include <cstring>
#include <string>
#include "MinHook.h"

namespace {
using CreateFileWFn = decltype(&CreateFileW);
using CreateFile2Fn = decltype(&CreateFile2);
using CreateProcessWFn = decltype(&CreateProcessW);
CreateFileWFn RealCreateFileW = nullptr;
CreateFile2Fn RealCreateFile2 = nullptr;
CreateProcessWFn RealCreateProcessW = nullptr;
std::wstring RedirectAsar, InjectorDll;

bool DisableEmbeddedAsarIntegrityFuse() {
    static constexpr char sentinel[] = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
    auto* base = reinterpret_cast<unsigned char*>(GetModuleHandleW(nullptr));
    if (!base) return false;
    auto* dos = reinterpret_cast<IMAGE_DOS_HEADER*>(base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return false;
    auto* nt = reinterpret_cast<IMAGE_NT_HEADERS*>(base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return false;
    const size_t imageSize = nt->OptionalHeader.SizeOfImage;
    const size_t sentinelLength = sizeof(sentinel) - 1;
    for (size_t i = 0; i + sentinelLength + 11 < imageSize; ++i) {
        if (memcmp(base + i, sentinel, sentinelLength) != 0) continue;
        unsigned char* wire = base + i + sentinelLength;
        if (wire[0] != 1 || wire[1] < 6) return false;
        unsigned char* integrityFuse = wire + 2 + 4;
        DWORD oldProtect = 0;
        if (!VirtualProtect(integrityFuse, 1, PAGE_READWRITE, &oldProtect)) return false;
        *integrityFuse = '0';
        FlushInstructionCache(GetCurrentProcess(), integrityFuse, 1);
        DWORD ignored = 0;
        VirtualProtect(integrityFuse, 1, oldProtect, &ignored);
        return true;
    }
    return false;
}

std::wstring Environment(const wchar_t* name) {
    DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
    if (!size) return {};
    std::wstring value(size, L'\0');
    DWORD written = GetEnvironmentVariableW(name, value.data(), size);
    if (!written) return {};
    value.resize(written); return value;
}
bool EndsWithInsensitive(const wchar_t* value, const wchar_t* suffix) {
    if (!value || !suffix) return false;
    size_t a = wcslen(value), b = wcslen(suffix);
    return b <= a && _wcsicmp(value + a - b, suffix) == 0;
}
bool IsClaudeExecutable(const wchar_t* application, wchar_t* commandLine) {
    if (application && EndsWithInsensitive(application, L"\\claude.exe")) return true;
    if (!commandLine) return false;
    std::wstring text(commandLine), executable;
    if (!text.empty() && text[0] == L'"') {
        auto end = text.find(L'"', 1); if (end != std::wstring::npos) executable = text.substr(1, end - 1);
    } else executable = text.substr(0, text.find(L' '));
    return EndsWithInsensitive(executable.c_str(), L"\\claude.exe");
}
bool InjectDll(HANDLE process, const std::wstring& dllPath) {
    SIZE_T bytes = (dllPath.size() + 1) * sizeof(wchar_t);
    void* remote = VirtualAllocEx(process, nullptr, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remote) return false;
    bool ok = WriteProcessMemory(process, remote, dllPath.c_str(), bytes, nullptr) != FALSE;
    auto loadLibrary = reinterpret_cast<LPTHREAD_START_ROUTINE>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"));
    HANDLE thread = ok ? CreateRemoteThread(process, nullptr, 0, loadLibrary, remote, 0, nullptr) : nullptr;
    if (thread) {
        ok = WaitForSingleObject(thread, 15000) == WAIT_OBJECT_0;
        DWORD result = 0; ok = ok && GetExitCodeThread(thread, &result) && result != 0; CloseHandle(thread);
    } else ok = false;
    VirtualFreeEx(process, remote, 0, MEM_RELEASE); return ok;
}
const wchar_t* RedirectedPath(LPCWSTR name) {
    if (!name) return nullptr;
    if (!RedirectAsar.empty() && EndsWithInsensitive(name, L"\\resources\\app.asar") && _wcsicmp(name, RedirectAsar.c_str()) != 0)
        return RedirectAsar.c_str();
    return nullptr;
}
HANDLE WINAPI HookCreateFileW(LPCWSTR name, DWORD access, DWORD share, LPSECURITY_ATTRIBUTES security, DWORD creation, DWORD flags, HANDLE templ) {
    const auto* redirected = RedirectedPath(name);
    return RealCreateFileW(redirected ? redirected : name, access, share, security, creation, flags, templ);
}
HANDLE WINAPI HookCreateFile2(LPCWSTR name, DWORD access, DWORD share, DWORD creation, LPCREATEFILE2_EXTENDED_PARAMETERS extended) {
    const auto* redirected = RedirectedPath(name);
    return RealCreateFile2(redirected ? redirected : name, access, share, creation, extended);
}
BOOL WINAPI HookCreateProcessW(LPCWSTR application, LPWSTR commandLine, LPSECURITY_ATTRIBUTES pa, LPSECURITY_ATTRIBUTES ta,
                               BOOL inherit, DWORD flags, LPVOID environment, LPCWSTR cwd, LPSTARTUPINFOW startup, LPPROCESS_INFORMATION info) {
    bool inject = !InjectorDll.empty() && IsClaudeExecutable(application, commandLine);
    bool suspended = (flags & CREATE_SUSPENDED) != 0;
    BOOL created = RealCreateProcessW(application, commandLine, pa, ta, inherit, inject ? flags | CREATE_SUSPENDED : flags,
                                      environment, cwd, startup, info);
    if (!created || !inject) return created;
    if (!InjectDll(info->hProcess, InjectorDll)) { TerminateProcess(info->hProcess, 1); SetLastError(ERROR_DLL_INIT_FAILED); return FALSE; }
    if (!suspended) ResumeThread(info->hThread);
    return TRUE;
}
bool InstallHooks() {
    RedirectAsar = Environment(L"CLAUDE_ZH_ASAR_PATH");
    InjectorDll = Environment(L"CLAUDE_ZH_INJECTOR_DLL");
    if (RedirectAsar.empty() || InjectorDll.empty()) return false;
    DisableEmbeddedAsarIntegrityFuse();
    if (MH_Initialize() != MH_OK) return false;
    if (MH_CreateHookApi(L"kernel32", "CreateFileW", &HookCreateFileW, reinterpret_cast<void**>(&RealCreateFileW)) != MH_OK) return false;
    MH_CreateHookApi(L"kernel32", "CreateFile2", &HookCreateFile2, reinterpret_cast<void**>(&RealCreateFile2));
    if (!RealCreateFile2) MH_CreateHookApi(L"kernelbase", "CreateFile2", &HookCreateFile2, reinterpret_cast<void**>(&RealCreateFile2));
    if (MH_CreateHookApi(L"kernel32", "CreateProcessW", &HookCreateProcessW, reinterpret_cast<void**>(&RealCreateProcessW)) != MH_OK) return false;
    return MH_EnableHook(MH_ALL_HOOKS) == MH_OK;
}
}
BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) { DisableThreadLibraryCalls(instance); InstallHooks(); }
    return TRUE;
}
