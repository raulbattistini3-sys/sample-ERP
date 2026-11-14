// Package supervisor runs development services as child processes of one terminal: every line they print
// comes out prefixed with "[name]", and stopping the supervisor stops all of them (gracefully first).
package supervisor

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Spec is one child: a command run in Dir with Env added to the supervisor's own environment.
type Spec struct {
	Name    string
	Dir     string
	Command string
	Args    []string
	Env     []string
}

// Supervisor owns the children.
type Supervisor struct {
	Grace time.Duration
	out   sync.Mutex
	procs []*proc
}

type proc struct {
	spec Spec
	cmd  *exec.Cmd
	done chan struct{}
}

// Logf prints one line under the supervisor's own prefix.
func (s *Supervisor) Logf(name, format string, args ...any) {
	s.line(name, fmt.Sprintf(format, args...))
}

func (s *Supervisor) line(name, text string) {
	s.out.Lock()
	defer s.out.Unlock()
	fmt.Fprintf(os.Stdout, "[%s] %s\n", name, text)
}

func (s *Supervisor) pipe(name string, r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		s.line(name, sc.Text())
	}
}

// Start launches one child. Its output is prefixed; exited reports when it ends (on its own or stopped).
func (s *Supervisor) Start(spec Spec, exited chan<- string) error {
	cmd := exec.Command(spec.Command, spec.Args...)
	cmd.Dir = spec.Dir
	cmd.Env = append(os.Environ(), spec.Env...)
	prepare(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%s: %w", spec.Name, err)
	}
	adopt(cmd)
	p := &proc{spec: spec, cmd: cmd, done: make(chan struct{})}
	s.procs = append(s.procs, p)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); s.pipe(spec.Name, stdout) }()
	go func() { defer wg.Done(); s.pipe(spec.Name, stderr) }()
	go func() {
		wg.Wait()
		err := cmd.Wait()
		close(p.done)
		if err != nil {
			s.Logf("network", "%s exited: %v", spec.Name, err)
		} else {
			s.Logf("network", "%s exited", spec.Name)
		}
		if exited != nil {
			exited <- spec.Name
		}
	}()
	s.Logf("network", "started %s: %s %v (in %s, pid %d)", spec.Name, spec.Command, spec.Args, spec.Dir, cmd.Process.Pid)
	return nil
}

// Stop asks every child to finish (in reverse start order: the API before the web app, so it can stop its
// own children), waits up to Grace, then kills what is left with everything it started.
func (s *Supervisor) Stop(ctx context.Context) {
	for i := len(s.procs) - 1; i >= 0; i-- {
		p := s.procs[i]
		select {
		case <-p.done:
			continue
		default:
		}
		terminate(p.cmd)
	}
	deadline := time.NewTimer(s.Grace)
	defer deadline.Stop()
	for _, p := range s.procs {
		select {
		case <-p.done:
		case <-deadline.C:
			s.Logf("network", "children still running after %s; killing them", s.Grace)
			s.killAll()
			return
		case <-ctx.Done():
			s.killAll()
			return
		}
	}
	// a clean exit can still leave grandchildren behind (go run's binary, Maven's JVM)
	s.killAll()
}

func (s *Supervisor) killAll() {
	for _, p := range s.procs {
		kill(p.cmd)
	}
	release()
}
