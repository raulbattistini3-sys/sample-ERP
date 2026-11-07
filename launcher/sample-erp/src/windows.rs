//! Windows-only process plumbing.

use std::{mem, ptr};
use windows_sys::Win32::System::{
    Console::GetConsoleProcessList,
    JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation, SetInformationJobObject,
    },
    Threading::GetCurrentProcess,
};

/// Process creation flag for children that must outlive the launcher (the browser it opens).
pub const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

/// Puts the launcher in a job object that kills every process in it when the launcher goes away,
/// so closing the console window or a crash never leaves api.exe, java or postgres running. The
/// handle is deliberately leaked: it closes, and the job fires, when this process ends.
pub fn kill_children_with_launcher() {
    unsafe {
        let job = CreateJobObjectW(ptr::null(), ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok != 0 {
            AssignProcessToJobObject(job, GetCurrentProcess());
        }
    }
}

/// Started from Explorer (double-click), the console closes as soon as the process exits, taking
/// any error message with it. Only this process is attached to the console in that case.
pub fn pause_if_double_clicked() {
    let mut pids = [0u32; 4];
    let attached = unsafe { GetConsoleProcessList(pids.as_mut_ptr(), pids.len() as u32) };
    if attached == 1 {
        println!("\nPress Enter to close this window.");
        let _ = std::io::stdin().read_line(&mut String::new());
    }
}
