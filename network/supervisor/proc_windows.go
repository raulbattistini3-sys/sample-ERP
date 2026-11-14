//go:build windows

package supervisor

import (
	"os/exec"
	"strconv"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Every child goes into one job object that kills its members when the supervisor's handle closes, so
// closing the terminal or killing the supervisor never leaves a service (or its go/java grandchildren)
// holding a port. Ctrl+C reaches all of them anyway, as they share the console; that is the graceful path.
var (
	jobOnce sync.Once
	job     windows.Handle
)

func theJob() windows.Handle {
	jobOnce.Do(func() {
		h, err := windows.CreateJobObject(nil, nil)
		if err != nil {
			return
		}
		info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
		info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		if _, err := windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation,
			uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
			_ = windows.CloseHandle(h)
			return
		}
		job = h
	})
	return job
}

func prepare(*exec.Cmd) {}

func adopt(cmd *exec.Cmd) {
	j := theJob()
	if j == 0 || cmd.Process == nil {
		return
	}
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	_ = windows.AssignProcessToJobObject(j, h)
}

// Ctrl+C was already delivered to the whole console; when Stop runs for another reason (a child died),
// CTRL_BREAK can't target a process that shares our group, so the tree is ended instead.
func terminate(cmd *exec.Cmd) {}

func kill(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F").Run()
}

func release() {
	if job != 0 {
		_ = windows.CloseHandle(job)
	}
}
