using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

internal static class Spike
{
    private const string SandboxUser = "PrismAgendaSandbox";
    private const string AllAppPackagesSid = "S-1-15-2-1";

    private const uint LOGON_WITH_PROFILE = 0x00000001;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const int STARTF_USESTDHANDLES = 0x00000100;

    private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    private const uint TOKEN_DUPLICATE = 0x0002;
    private const uint TOKEN_QUERY = 0x0008;

    private const uint DISABLE_MAX_PRIVILEGE = 0x0001;
    private const uint SE_GROUP_ENABLED = 0x00000004;

    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint CREATE_ALWAYS = 2;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;

    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    private const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint INFINITE = 0xFFFFFFFF;

    private const uint CRYPTPROTECT_LOCAL_MACHINE = 0x4;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct USER_INFO_1
    {
        public string usri1_name;
        public string usri1_password;
        public uint usri1_password_age;
        public uint usri1_priv;
        public string usri1_home_dir;
        public string usri1_comment;
        public uint usri1_flags;
        public string usri1_script_path;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct USER_INFO_1003
    {
        public string usri1003_password;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct LOCALGROUP_MEMBERS_INFO_3
    {
        public string domainandname;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB
    {
        public int cbData;
        public IntPtr pbData;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID_AND_ATTRIBUTES
    {
        public LUID Luid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_PRIVILEGES
    {
        public uint PrivilegeCount;
        public LUID_AND_ATTRIBUTES Privileges;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_USER
    {
        public SID_AND_ATTRIBUTES User;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_OWNER
    {
        public IntPtr Owner;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_PRIMARY_GROUP
    {
        public IntPtr PrimaryGroup;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_DEFAULT_DACL
    {
        public IntPtr DefaultDacl;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_SOURCE
    {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
        public byte[] SourceName;
        public LUID SourceIdentifier;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LARGE_INTEGER
    {
        public long QuadPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_MANDATORY_LABEL
    {
        public SID_AND_ATTRIBUTES Label;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessWithLogonW(
        string lpUsername,
        string lpDomain,
        string lpPassword,
        uint dwLogonFlags,
        string lpApplicationName,
        StringBuilder lpCommandLine,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUserW(
        IntPtr hToken,
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(
        IntPtr ExistingTokenHandle,
        uint Flags,
        int DisableSidCount,
        SID_AND_ATTRIBUTES[] SidsToDisable,
        int DeletePrivilegeCount,
        IntPtr PrivilegesToDelete,
        int RestrictedSidCount,
        SID_AND_ATTRIBUTES[] SidsToRestrict,
        out IntPtr NewTokenHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSidToSidW(string StringSid, out IntPtr Sid);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFileW(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        ref SECURITY_ATTRIBUTES lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetUserAdd(string servername, int level, ref USER_INFO_1 buf, out int parm_err);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetUserSetInfo(string servername, string username, int level, ref USER_INFO_1003 buf, out int parm_err);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetLocalGroupAddMembers(string servername, string groupname, int level, ref LOCALGROUP_MEMBERS_INFO_3 buf, int totalentries);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool LookupAccountSidW(
        string lpSystemName,
        IntPtr lpSid,
        StringBuilder lpName,
        ref int cchName,
        StringBuilder lpReferencedDomainName,
        ref int cchReferencedDomainName,
        out int peUse);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DATA_BLOB pDataIn,
        string szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        uint dwFlags,
        out DATA_BLOB pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DATA_BLOB pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        uint dwFlags,
        out DATA_BLOB pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);

    [DllImport("ntdll.dll")]
    private static extern int NtCreateToken(
        out IntPtr TokenHandle,
        uint DesiredAccess,
        IntPtr ObjectAttributes,
        int TokenType,
        ref LUID AuthenticationId,
        ref LARGE_INTEGER ExpirationTime,
        IntPtr TokenUser,
        IntPtr TokenGroups,
        IntPtr TokenPrivileges,
        IntPtr TokenOwner,
        IntPtr TokenPrimaryGroup,
        IntPtr TokenDefaultDacl,
        ref TOKEN_SOURCE TokenSource);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool LookupPrivilegeValueW(string lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool InitializeAcl(IntPtr pAcl, uint nAclLength, uint dwAclRevision);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AddAccessAllowedAce(IntPtr pAcl, uint dwAceRevision, uint AccessMask, IntPtr pSid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int GetLengthSid(IntPtr pSid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, IntPtr TokenInformation, uint TokenInformationLength);

    private sealed class Options
    {
        public string TaskSid;
        public string Cwd;
        public string Control;
        public string Command;
        public string Sids = "all,task";
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0)
            {
                Usage();
                return 2;
            }

            switch (args[0])
            {
                case "setup": return Setup(args);
                case "acl": return Acl(args);
                case "run": return Run(args);
                case "inside": return Inside(args);
                case "system-test": return SystemTest(args);
                default:
                    Usage();
                    return 2;
            }
        }
        catch (Win32Exception ex)
        {
            TryWriteInsideError(args, ex);
            Console.Error.WriteLine("SPIKE_ERROR: " + ex.Message + " (Win32 " + ex.NativeErrorCode + ")");
            return 99;
        }
        catch (Exception ex)
        {
            TryWriteInsideError(args, ex);
            Console.Error.WriteLine("SPIKE_ERROR: " + ex);
            return 99;
        }
    }

    private static void TryWriteInsideError(string[] args, Exception ex)
    {
        try
        {
            if (args.Length == 0 || args[0] != "inside") return;

            string cwd = null;
            for (int i = 1; i < args.Length - 1; i++)
            {
                if (args[i] == "--cwd") { cwd = args[i + 1]; break; }
            }

            if (string.IsNullOrEmpty(cwd)) return;

            string dir = Path.Combine(cwd, ".agenda", "spike");
            Directory.CreateDirectory(dir);
            File.WriteAllText(
                Path.Combine(dir, "error.log"),
                DateTime.UtcNow.ToString("o") + "\r\n" + ex + "\r\n",
                Encoding.UTF8);
        }
        catch
        {
            // Best effort only.
        }
    }

    private static void Usage()
    {
        Console.Error.WriteLine("Usage:");
        Console.Error.WriteLine("  Spike.exe setup [password]");
        Console.Error.WriteLine("  Spike.exe acl --path <dir> --mode <workspace|readonly|owneronly> [--task <sid>]");
        Console.Error.WriteLine("  Spike.exe run --task <sid> --cwd <dir> --control <file> --command <command>");
        Console.Error.WriteLine("  Spike.exe inside --task <sid> --cwd <dir> --control <file> --command <command>");
    }

    private static int Setup(string[] args)
    {
        RequireAdmin();
        string password = args.Length > 1 ? args[1] : GeneratePassword();

        CreateOrUpdateUser(SandboxUser, password);
        AddToUsersGroup(SandboxUser);

        string credDir = CredentialDir();
        Directory.CreateDirectory(credDir);
        SetDirectoryAcl(credDir, "owneronly", null);
        string credFile = Path.Combine(credDir, "credential.bin");
        WriteProtectedFile(credFile, password);

        Console.WriteLine("SETUP: warming profile for " + SandboxUser + " ...");
        int code = LaunchAsUser(SandboxUser, password, Path.Combine(Environment.SystemDirectory, "cmd.exe"), "/c exit", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), true, true);
        if (code != 0)
        {
            throw new Exception("profile warm-up exited with " + code);
        }

        Console.WriteLine("SETUP_OK user=" + SandboxUser + " credential=" + credFile);
        return 0;
    }

    private static int Acl(string[] args)
    {
        string path = null;
        string mode = null;
        string task = null;

        for (int i = 1; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--path": path = args[++i]; break;
                case "--mode": mode = args[++i]; break;
                case "--task": task = args[++i]; break;
                default: throw new Exception("unknown acl arg: " + args[i]);
            }
        }

        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(mode)) throw new Exception("acl requires --path and --mode");
        if (!Directory.Exists(path)) throw new Exception("acl path does not exist: " + path);

        switch (mode)
        {
            case "workspace":
                if (string.IsNullOrEmpty(task)) throw new Exception("workspace mode requires --task");
                SetDirectoryAcl(path, mode, task);
                break;

            case "readonly":
                if (string.IsNullOrEmpty(task)) throw new Exception("readonly mode requires --task");
                SetDirectoryAcl(path, mode, task);
                break;

            case "owneronly":
                SetDirectoryAcl(path, mode, null);
                break;

            default:
                throw new Exception("unknown acl mode: " + mode);
        }

        Console.WriteLine("ACL_OK " + path + " mode=" + mode);
        return 0;
    }

    private static void SetDirectoryAcl(string path, string mode, string taskSid)
    {
        SecurityIdentifier me = WindowsIdentity.GetCurrent().User;
        SecurityIdentifier sandbox = (SecurityIdentifier)new NTAccount(SandboxUser).Translate(typeof(SecurityIdentifier));

        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(true, false);

        const InheritanceFlags inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;

        security.AddAccessRule(new FileSystemAccessRule(
            me,
            FileSystemRights.FullControl,
            inherit,
            PropagationFlags.None,
            AccessControlType.Allow));

        SecurityIdentifier system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        security.AddAccessRule(new FileSystemAccessRule(
            system,
            FileSystemRights.FullControl,
            inherit,
            PropagationFlags.None,
            AccessControlType.Allow));

        switch (mode)
        {
            case "workspace":
            {
                var task = new SecurityIdentifier(taskSid);
                security.AddAccessRule(new FileSystemAccessRule(sandbox, FileSystemRights.Modify, inherit, PropagationFlags.None, AccessControlType.Allow));
                security.AddAccessRule(new FileSystemAccessRule(task, FileSystemRights.Modify, inherit, PropagationFlags.None, AccessControlType.Allow));
                break;
            }

            case "readonly":
            {
                var task = new SecurityIdentifier(taskSid);
                security.AddAccessRule(new FileSystemAccessRule(sandbox, FileSystemRights.Read, inherit, PropagationFlags.None, AccessControlType.Allow));
                security.AddAccessRule(new FileSystemAccessRule(task, FileSystemRights.Read, inherit, PropagationFlags.None, AccessControlType.Allow));
                break;
            }

            case "owneronly":
                security.AddAccessRule(new FileSystemAccessRule(sandbox, FileSystemRights.FullControl, inherit, PropagationFlags.None, AccessControlType.Deny));
                break;

            default:
                throw new Exception("unknown acl mode: " + mode);
        }

        Directory.SetAccessControl(path, security);
    }

    private static int Run(string[] args)
    {
        Options o = Parse(args, 1);
        string password = ReadProtectedFile(Path.Combine(CredentialDir(), "credential.bin"));
        string exe = Process.GetCurrentProcess().MainModule.FileName;

        string insideArgs =
            "inside --task " + Quote(o.TaskSid) +
            " --cwd " + Quote(o.Cwd) +
            " --control " + Quote(o.Control) +
            " --sids " + Quote(o.Sids) +
            " --command " + Quote(o.Command);

        IntPtr env = BuildEnvironment(o.Cwd);
        try
        {
            var si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            var cmd = new StringBuilder(Quote(exe) + " " + insideArgs);
            PROCESS_INFORMATION pi;

            bool ok = CreateProcessWithLogonW(
                SandboxUser,
                ".",
                password,
                LOGON_WITH_PROFILE,
                exe,
                cmd,
                CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                env,
                o.Cwd,
                ref si,
                out pi);

            Check(ok, "CreateProcessWithLogonW");

            Console.WriteLine("INSIDE_PID=" + pi.dwProcessId);
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
        }
        finally
        {
            Marshal.FreeHGlobal(env);
        }

        return 0;
    }

    private static int Inside(string[] args)
    {
        Options o = Parse(args, 1);
        string agenda = Path.Combine(o.Cwd, ".agenda");
        string spikeDir = Path.Combine(agenda, "spike");
        Directory.CreateDirectory(spikeDir);

        string id = Guid.NewGuid().ToString("N");
        string scriptPath = Path.Combine(spikeDir, "cmd-" + id + ".cmd");
        string stdoutPath = Path.Combine(spikeDir, "stdout-" + id + ".log");
        string stderrPath = Path.Combine(spikeDir, "stderr-" + id + ".log");

        File.WriteAllText(scriptPath, "@echo off\r\n" + o.Command + "\r\n", Encoding.ASCII);

        IntPtr stdoutHandle = CreateInheritableFile(stdoutPath, GENERIC_WRITE, CREATE_ALWAYS);
        IntPtr stderrHandle = CreateInheritableFile(stderrPath, GENERIC_WRITE, CREATE_ALWAYS);
        IntPtr nulHandle = CreateInheritableFile("NUL", GENERIC_READ, OPEN_EXISTING);

        IntPtr token = IntPtr.Zero;
        IntPtr restricted = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr env = IntPtr.Zero;
        var allocatedSids = new List<IntPtr>();

        try
        {
            Check(OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY, out token), "OpenProcessToken");

            var sidNames = new List<string>();
            foreach (string part in o.Sids.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                switch (part.Trim())
                {
                    case "all": sidNames.Add(AllAppPackagesSid); break;
                    case "restricted": sidNames.Add("S-1-15-2-2"); break;
                    case "everyone": sidNames.Add("S-1-1-0"); break;
                    case "users": sidNames.Add("S-1-5-32-545"); break;
                    case "task": sidNames.Add(o.TaskSid); break;
                    default: sidNames.Add(part.Trim()); break;
                }
            }

            var sids = new SID_AND_ATTRIBUTES[sidNames.Count];
            for (int i = 0; i < sidNames.Count; i++)
            {
                IntPtr sid;
                Check(ConvertStringSidToSidW(sidNames[i], out sid), "ConvertStringSidToSid(" + sidNames[i] + ")");
                allocatedSids.Add(sid);
                sids[i].Sid = sid;
                sids[i].Attributes = 0;
            }

            Check(
                CreateRestrictedToken(token, DISABLE_MAX_PRIVILEGE, 0, null, 0, IntPtr.Zero, sids.Length, sids, out restricted),
                "CreateRestrictedToken(" + string.Join(",", sidNames.ToArray()) + ")");

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject");
            ConfigureJob(job);

            env = BuildEnvironment(o.Cwd);

            var si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput = nulHandle;
            si.hStdOutput = stdoutHandle;
            si.hStdError = stderrHandle;

            string cmdExe = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            var cmd = new StringBuilder(Quote(cmdExe) + " /d /s /c " + Quote(scriptPath));

            PROCESS_INFORMATION pi;
            bool ok = CreateProcessAsUserW(
                restricted,
                cmdExe,
                cmd,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | CREATE_SUSPENDED,
                env,
                o.Cwd,
                ref si,
                out pi);

            Check(ok, "CreateProcessAsUser");

            Check(AssignProcessToJobObject(job, pi.hProcess), "AssignProcessToJobObject");
            Check(ResumeThread(pi.hThread) != 0xFFFFFFFF, "ResumeThread");

            WriteControl(o.Control, pi.dwProcessId, null, stdoutPath, stderrPath);

            uint wait = WaitForSingleObject(pi.hProcess, INFINITE);
            if (wait != 0) throw new Exception("WaitForSingleObject returned " + wait);

            uint exitCode;
            Check(GetExitCodeProcess(pi.hProcess, out exitCode), "GetExitCodeProcess");

            WriteControl(o.Control, pi.dwProcessId, (int)exitCode, stdoutPath, stderrPath);

            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            return (int)exitCode;
        }
        finally
        {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
            if (restricted != IntPtr.Zero) CloseHandle(restricted);
            if (token != IntPtr.Zero) CloseHandle(token);
            foreach (IntPtr sid in allocatedSids) LocalFree(sid);
            if (stdoutHandle != IntPtr.Zero) CloseHandle(stdoutHandle);
            if (stderrHandle != IntPtr.Zero) CloseHandle(stderrHandle);
            if (nulHandle != IntPtr.Zero) CloseHandle(nulHandle);
        }
    }

    private static void ConfigureJob(IntPtr job)
    {
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
            JOB_OBJECT_LIMIT_ACTIVE_PROCESS |
            JOB_OBJECT_LIMIT_PROCESS_MEMORY |
            JOB_OBJECT_LIMIT_JOB_MEMORY;
        info.BasicLimitInformation.ActiveProcessLimit = 64;
        info.ProcessMemoryLimit = (UIntPtr)(2UL * 1024 * 1024 * 1024);
        info.JobMemoryLimit = (UIntPtr)(4UL * 1024 * 1024 * 1024);

        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)size), "SetInformationJobObject");
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    private static Options Parse(string[] args, int start)
    {
        var o = new Options();
        for (int i = start; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--task": o.TaskSid = args[++i]; break;
                case "--cwd": o.Cwd = args[++i]; break;
                case "--control": o.Control = args[++i]; break;
                case "--command": o.Command = args[++i]; break;
                case "--sids": o.Sids = args[++i]; break;
                default: throw new Exception("unknown arg: " + args[i]);
            }
        }

        if (string.IsNullOrEmpty(o.TaskSid)) throw new Exception("missing --task");
        if (string.IsNullOrEmpty(o.Cwd)) throw new Exception("missing --cwd");
        if (string.IsNullOrEmpty(o.Control)) throw new Exception("missing --control");
        if (o.Command == null) throw new Exception("missing --command");

        return o;
    }

    private static IntPtr BuildEnvironment(string workspace)
    {
        string agenda = Path.Combine(workspace, ".agenda");
        string home = Path.Combine(agenda, "home");
        string temp = Path.Combine(agenda, "tmp");
        string appData = Path.Combine(agenda, "appdata");
        string localAppData = Path.Combine(agenda, "localappdata");
        string npmCache = Path.Combine(agenda, "runtime", "npm");

        Directory.CreateDirectory(home);
        Directory.CreateDirectory(temp);
        Directory.CreateDirectory(appData);
        Directory.CreateDirectory(localAppData);
        Directory.CreateDirectory(npmCache);

        var vars = new Dictionary<string, string>
        {
            { "SystemRoot", @"C:\Windows" },
            { "windir", @"C:\Windows" },
            { "ComSpec", @"C:\Windows\System32\cmd.exe" },
            { "PATH", @"C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Git\bin" },
            { "PATHEXT", ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.MSC" },
            { "USERPROFILE", home },
            { "HOME", home },
            { "TEMP", temp },
            { "TMP", temp },
            { "APPDATA", appData },
            { "LOCALAPPDATA", localAppData },
            { "npm_config_cache", npmCache },
            { "NUMBER_OF_PROCESSORS", Environment.ProcessorCount.ToString() },
            { "PROCESSOR_ARCHITECTURE", "AMD64" },
            { "OS", "Windows_NT" }
        };

        var sb = new StringBuilder();
        foreach (KeyValuePair<string, string> kv in vars)
        {
            sb.Append(kv.Key).Append('=').Append(kv.Value).Append('\0');
        }
        sb.Append('\0');

        return Marshal.StringToHGlobalUni(sb.ToString());
    }

    private static IntPtr CreateInheritableFile(string path, uint access, uint disposition)
    {
        var sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = true;

        IntPtr handle = CreateFileW(path, access, FILE_SHARE_READ | FILE_SHARE_WRITE, ref sa, disposition, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (handle == new IntPtr(-1))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateFile " + path);
        }

        return handle;
    }

    private static void WriteControl(string path, int childPid, int? exitCode, string stdoutPath, string stderrPath)
    {
        var sb = new StringBuilder();
        sb.Append("{\"insidePid\":").Append(Process.GetCurrentProcess().Id);
        sb.Append(",\"childPid\":").Append(childPid);
        if (stdoutPath != null) sb.Append(",\"stdout\":\"").Append(JsonEscape(stdoutPath)).Append('"');
        if (stderrPath != null) sb.Append(",\"stderr\":\"").Append(JsonEscape(stderrPath)).Append('"');
        if (exitCode.HasValue) sb.Append(",\"exitCode\":").Append(exitCode.Value);
        sb.Append('}');
        File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
    }

    private static string JsonEscape(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    private static void CreateOrUpdateUser(string user, string password)
    {
        var info = new USER_INFO_1();
        info.usri1_name = user;
        info.usri1_password = password;
        info.usri1_priv = 1; // USER_PRIV_USER
        info.usri1_comment = "Prism Agenda sandbox account";
        info.usri1_flags = 0x0001 | 0x10000; // UF_SCRIPT | UF_DONT_EXPIRE_PASSWD

        int parm;
        int result = NetUserAdd(null, 1, ref info, out parm);
        if (result == 0)
        {
            Console.WriteLine("SETUP: created user " + user);
            return;
        }

        if (result == 2224) // NERR_UserExists
        {
            var pwd = new USER_INFO_1003();
            pwd.usri1003_password = password;
            result = NetUserSetInfo(null, user, 1003, ref pwd, out parm);
            if (result != 0) throw new Exception("NetUserSetInfo failed: " + result + " (parm " + parm + ")");
            Console.WriteLine("SETUP: updated password for existing user " + user);
            return;
        }

        throw new Exception("NetUserAdd failed: " + result + " (parm " + parm + ")");
    }

    private static void AddToUsersGroup(string user)
    {
        string groupName = LookupWellKnownGroupName("S-1-5-32-545");

        var member = new LOCALGROUP_MEMBERS_INFO_3();
        member.domainandname = user;
        int result = NetLocalGroupAddMembers(null, groupName, 3, ref member, 1);
        if (result != 0 && result != 1378) // ERROR_MEMBER_IN_ALIAS
        {
            throw new Exception("NetLocalGroupAddMembers(" + groupName + ") failed: " + result);
        }
    }

    private static string LookupWellKnownGroupName(string sidString)
    {
        IntPtr sid;
        Check(ConvertStringSidToSidW(sidString, out sid), "ConvertStringSidToSid(" + sidString + ")");
        try
        {
            int nameLength = 256;
            int domainLength = 256;
            var name = new StringBuilder(nameLength);
            var domain = new StringBuilder(domainLength);
            int use;
            Check(
                LookupAccountSidW(null, sid, name, ref nameLength, domain, ref domainLength, out use),
                "LookupAccountSid(" + sidString + ")");
            return name.ToString();
        }
        finally
        {
            LocalFree(sid);
        }
    }

    private static int LaunchAsUser(string user, string password, string exe, string args, string cwd, bool withProfile, bool wait)
    {
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        var cmd = new StringBuilder(Quote(exe) + " " + args);
        PROCESS_INFORMATION pi;

        bool ok = CreateProcessWithLogonW(
            user,
            ".",
            password,
            withProfile ? LOGON_WITH_PROFILE : 0,
            exe,
            cmd,
            CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            IntPtr.Zero,
            cwd,
            ref si,
            out pi);

        Check(ok, "CreateProcessWithLogonW");

        CloseHandle(pi.hThread);

        if (!wait)
        {
            CloseHandle(pi.hProcess);
            return 0;
        }

        uint waitResult = WaitForSingleObject(pi.hProcess, 120000);
        if (waitResult != 0) throw new Exception("warm-up wait returned " + waitResult);

        uint exitCode;
        Check(GetExitCodeProcess(pi.hProcess, out exitCode), "GetExitCodeProcess");
        CloseHandle(pi.hProcess);
        return (int)exitCode;
    }

    private static string CredentialDir()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PrismDesktop",
            "agenda",
            "spike");
    }

    private static void WriteProtectedFile(string path, string value)
    {
        byte[] blob = Protect(value);
        byte[] length = BitConverter.GetBytes(blob.Length);
        using (var stream = File.Create(path))
        {
            stream.Write(length, 0, length.Length);
            stream.Write(blob, 0, blob.Length);
        }
    }

    private static string ReadProtectedFile(string path)
    {
        byte[] bytes = File.ReadAllBytes(path);
        int length = BitConverter.ToInt32(bytes, 0);
        byte[] blob = new byte[length];
        Array.Copy(bytes, 4, blob, 0, length);
        return Unprotect(blob);
    }

    private static byte[] Protect(string value)
    {
        byte[] data = Encoding.UTF8.GetBytes(value);
        var input = new DATA_BLOB();
        input.cbData = data.Length;
        input.pbData = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, input.pbData, data.Length);

        DATA_BLOB output;
        try
        {
            Check(CryptProtectData(ref input, "PrismAgendaSpike", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_LOCAL_MACHINE, out output), "CryptProtectData");
            byte[] result = new byte[output.cbData];
            Marshal.Copy(output.pbData, result, 0, output.cbData);
            LocalFree(output.pbData);
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(input.pbData);
        }
    }

    private static string Unprotect(byte[] blob)
    {
        var input = new DATA_BLOB();
        input.cbData = blob.Length;
        input.pbData = Marshal.AllocHGlobal(blob.Length);
        Marshal.Copy(blob, 0, input.pbData, blob.Length);

        DATA_BLOB output;
        try
        {
            Check(CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out output), "CryptUnprotectData");
            byte[] result = new byte[output.cbData];
            Marshal.Copy(output.pbData, result, 0, output.cbData);
            LocalFree(output.pbData);
            return Encoding.UTF8.GetString(result);
        }
        finally
        {
            Marshal.FreeHGlobal(input.pbData);
        }
    }

    private static void RequireAdmin()
    {
        var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
        {
            throw new Exception("setup requires an elevated process");
        }
    }

    private static string GeneratePassword()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
        var bytes = new byte[32];
        using (var rng = new RNGCryptoServiceProvider())
        {
            rng.GetBytes(bytes);
        }

        var sb = new StringBuilder(32);
        for (int i = 0; i < bytes.Length; i++)
        {
            sb.Append(alphabet[bytes[i] % alphabet.Length]);
        }

        return sb.ToString();
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void Check(bool ok, string what)
    {
        if (!ok)
        {
            int code = Marshal.GetLastWin32Error();
            throw new Exception(what + " failed (Win32 " + code + ")");
        }
    }
}
