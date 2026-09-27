package coderunner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

type Language struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}
type Status struct {
	Description string `json:"description"`
}
type Result struct {
	Stdout        string `json:"stdout"`
	Stderr        string `json:"stderr"`
	CompileOutput string `json:"compileOutput"`
	Message       string `json:"message"`
	Status        Status `json:"status"`
	Time          string `json:"time"`
	Memory        int    `json:"memory"`
}
type Runner interface {
	Languages(context.Context) ([]Language, error)
	Run(context.Context, int, string, string) (Result, error)
}
type Client struct {
	endpoint string
	http     *http.Client
	logger   *slog.Logger
}
type runtime struct {
	Language
	source   string
	compile  []string
	artifact string
	run      []string
}

var runtimes = []runtime{
	{Language: Language{ID: 1, Name: "Python"}, source: "source.py", run: []string{"/usr/bin/python3", "source.py"}},
	{Language: Language{ID: 2, Name: "JavaScript"}, source: "source.js", run: []string{"/usr/bin/node", "source.js"}},
	{Language: Language{ID: 3, Name: "TypeScript"}, source: "source.ts", compile: []string{"/usr/bin/tsc", "source.ts", "--target", "ES2022", "--module", "commonjs", "--outDir", "."}, artifact: "source.js", run: []string{"/usr/bin/node", "source.js"}},
	{Language: Language{ID: 4, Name: "C"}, source: "source.c", compile: []string{"/usr/bin/gcc", "source.c", "-O2", "-o", "program"}, artifact: "program", run: []string{"./program"}},
	{Language: Language{ID: 5, Name: "C++"}, source: "source.cpp", compile: []string{"/usr/bin/g++", "source.cpp", "-O2", "-o", "program"}, artifact: "program", run: []string{"./program"}},
	{Language: Language{ID: 6, Name: "Java"}, source: "Main.java", compile: []string{"/bin/sh", "-c", "/usr/lib/jvm/default-java/bin/javac -J-Xmx512m -J-XX:+UseSerialGC -J-XX:ActiveProcessorCount=2 Main.java && tar -cf classes.tar -- *.class"}, artifact: "classes.tar", run: []string{"/bin/sh", "-c", "tar -xf classes.tar && exec /usr/lib/jvm/default-java/bin/java -Xmx256m -XX:+UseSerialGC -XX:ActiveProcessorCount=2 Main"}},
	{Language: Language{ID: 7, Name: "Go"}, source: "source.go", compile: []string{"/usr/bin/go", "build", "-o", "program", "source.go"}, artifact: "program", run: []string{"./program"}},
	{Language: Language{ID: 8, Name: "Rust"}, source: "source.rs", compile: []string{"/usr/bin/rustc", "-C", "linker=/usr/bin/gcc", "-O", "source.rs", "-o", "program"}, artifact: "program", run: []string{"./program"}},
}

type command struct {
	Args          []string                  `json:"args"`
	Env           []string                  `json:"env"`
	Files         []any                     `json:"files"`
	CPULimit      int64                     `json:"cpuLimit"`
	ClockLimit    int64                     `json:"clockLimit"`
	MemoryLimit   int64                     `json:"memoryLimit"`
	ProcLimit     int                       `json:"procLimit"`
	CopyIn        map[string]map[string]any `json:"copyIn"`
	CopyOutCached []string                  `json:"copyOutCached,omitempty"`
}
type judgeResult struct {
	Status     string            `json:"status"`
	Error      string            `json:"error"`
	ExitStatus int               `json:"exitStatus"`
	Time       int64             `json:"time"`
	Memory     int               `json:"memory"`
	Files      map[string]string `json:"files"`
	FileIDs    map[string]string `json:"fileIds"`
}

func New(settings config.Runner, client *http.Client, logger *slog.Logger) *Client {
	return &Client{endpoint: strings.TrimRight(settings.Endpoint, "/"), http: client, logger: logger}
}
func Supports(languageID int) bool { _, ok := runtimeFor(languageID); return ok }
func (c *Client) Languages(context.Context) ([]Language, error) {
	languages := make([]Language, len(runtimes))
	for i, runtime := range runtimes {
		languages[i] = runtime.Language
	}
	return languages, nil
}

func (c *Client) Run(ctx context.Context, languageID int, sourceCode, stdin string) (Result, error) {
	runtime, ok := runtimeFor(languageID)
	if !ok || len(runtime.run) == 0 {
		return Result{}, fmt.Errorf("unsupported code language")
	}
	compileOutput := ""
	copyIn := map[string]map[string]any{runtime.source: {"content": sourceCode}}
	if len(runtime.compile) > 0 {
		compiled, err := c.execute(ctx, command{Args: runtime.compile, Env: environment(), Files: files(""), CPULimit: 15_000_000_000, ClockLimit: 18_000_000_000, MemoryLimit: 1024 * 1024 * 1024, ProcLimit: 256, CopyIn: copyIn, CopyOutCached: []string{runtime.artifact}})
		if err != nil {
			return Result{}, err
		}
		artifactID := compiled.FileIDs[runtime.artifact]
		if artifactID != "" {
			defer func() {
				cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
				defer cancel()
				if err := c.request(cleanupContext, http.MethodDelete, "/file/"+url.PathEscape(artifactID), nil, nil); err != nil {
					c.logger.WarnContext(cleanupContext, "code runner artifact cleanup failed", "artifact_id", artifactID, "error", err)
				}
			}()
		}
		compileOutput = compiled.Files["stderr"] + compiled.Files["stdout"]
		if compiled.Status != "Accepted" {
			return Result{CompileOutput: compileOutput, Message: compiled.Error, Status: Status{Description: "Compilation Error"}, Time: formatTime(compiled.Time), Memory: compiled.Memory}, nil
		}
		if artifactID == "" {
			return Result{}, fmt.Errorf("go-judge did not return compiled artifact")
		}
		copyIn = map[string]map[string]any{runtime.artifact: {"fileId": artifactID}}
	}
	result, err := c.execute(ctx, command{Args: runtime.run, Env: environment(), Files: files(stdin), CPULimit: 3_000_000_000, ClockLimit: 6_000_000_000, MemoryLimit: 512 * 1024 * 1024, ProcLimit: 64, CopyIn: copyIn})
	if err != nil {
		return Result{}, err
	}
	return Result{Stdout: result.Files["stdout"], Stderr: result.Files["stderr"], CompileOutput: compileOutput, Message: result.Error, Status: Status{Description: executionStatus(result.Status)}, Time: formatTime(result.Time), Memory: result.Memory}, nil
}

func runtimeFor(languageID int) (runtime, bool) {
	if languageID < 1 || languageID > len(runtimes) {
		return runtime{}, false
	}
	runtime := runtimes[languageID-1]
	return runtime, runtime.ID == languageID
}
func (c *Client) request(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.endpoint+path, body)
	if err != nil {
		return err
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("code runner request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return fmt.Errorf("code runner returned status %d", response.StatusCode)
	}
	if output == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	if err = json.NewDecoder(response.Body).Decode(output); err != nil {
		return fmt.Errorf("invalid code runner response: %w", err)
	}
	return nil
}
func (c *Client) execute(ctx context.Context, cmd command) (judgeResult, error) {
	var results []judgeResult
	if err := c.request(ctx, http.MethodPost, "/run", map[string]any{"cmd": []command{cmd}}, &results); err != nil {
		return judgeResult{}, err
	}
	if len(results) != 1 {
		return judgeResult{}, fmt.Errorf("invalid go-judge result count")
	}
	return results[0], nil
}
func files(stdin string) []any {
	return []any{map[string]string{"content": stdin}, map[string]any{"name": "stdout", "max": 1 << 20}, map[string]any{"name": "stderr", "max": 1 << 20}}
}
func environment() []string {
	return []string{"HOME=/w", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
}
func executionStatus(status string) string {
	if status == "Accepted" {
		return "Completed"
	}
	if status == "Time Limit Exceeded" {
		return status
	}
	return "Runtime Error"
}
func formatTime(nanoseconds int64) string {
	formatted := strconv.FormatFloat(float64(nanoseconds)/1_000_000_000, 'f', 3, 64)
	formatted = strings.TrimRight(formatted, "0")
	return strings.TrimRight(formatted, ".")
}
