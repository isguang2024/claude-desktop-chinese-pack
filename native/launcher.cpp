#include <windows.h>
#include <shellapi.h>
#include <string>

namespace {
bool InjectDll(HANDLE process, const std::wstring& dllPath) {
    const SIZE_T bytes = (dllPath.size() + 1) * sizeof(wchar_t);
    void* remote = VirtualAllocEx(process, nullptr, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remote) return false;
    bool ok = WriteProcessMemory(process, remote, dllPath.c_str(), bytes, nullptr) != FALSE;
    auto loadLibrary = reinterpret_cast<LPTHREAD_START_ROUTINE>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"));
    HANDLE thread = ok ? CreateRemoteThread(process, nullptr, 0, loadLibrary, remote, 0, nullptr) : nullptr;
    if (thread) {
        ok = WaitForSingleObject(thread, 15000) == WAIT_OBJECT_0;
        DWORD result = 0;
        ok = ok && GetExitCodeThread(thread, &result) && result != 0;
        CloseHandle(thread);
    } else ok = false;
    VirtualFreeEx(process, remote, 0, MEM_RELEASE);
    return ok;
}
void Error(const wchar_t* message) { MessageBoxW(nullptr, message, L"Claude 中文语言包", MB_OK | MB_ICONERROR); }
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    int argc = 0;
    wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv || argc < 5) { Error(L"启动参数不完整，请重新运行语言包安装程序。"); if (argv) LocalFree(argv); return 2; }
    const std::wstring exePath = argv[1], dllPath = argv[2], asarPath = argv[3], i18nPath = argv[4];
    std::wstring extraArguments;
    for (int i = 6; i < argc; ++i) extraArguments += L" \"" + std::wstring(argv[i]) + L"\"";
    LocalFree(argv);
    SetEnvironmentVariableW(L"CLAUDE_ZH_INJECTOR_DLL", dllPath.c_str());
    SetEnvironmentVariableW(L"CLAUDE_ZH_ASAR_PATH", asarPath.c_str());
    SetEnvironmentVariableW(L"CLAUDE_ZH_I18N_PATH", i18nPath.c_str());
    std::wstring command = L"\"" + exePath + L"\"" + extraArguments;
    STARTUPINFOW startup{}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(exePath.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED, nullptr, nullptr, &startup, &process)) {
        Error(L"无法启动官方 Claude Desktop。"); return 3;
    }
    if (!InjectDll(process.hProcess, dllPath)) {
        TerminateProcess(process.hProcess, 1); CloseHandle(process.hThread); CloseHandle(process.hProcess);
        Error(L"中文语言包注入失败，Claude 未被启动。可能被安全软件拦截。"); return 4;
    }
    ResumeThread(process.hThread);
    CloseHandle(process.hThread);
    if (GetEnvironmentVariableW(L"CLAUDE_ZH_WAIT", nullptr, 0) != 0) WaitForSingleObject(process.hProcess, INFINITE);
    CloseHandle(process.hProcess);
    return 0;
}
