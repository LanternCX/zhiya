package main

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

type codeLanguage struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type codeRunStatus struct {
	Description string `json:"description"`
}

type codeRunResult struct {
	Stdout        string        `json:"stdout"`
	Stderr        string        `json:"stderr"`
	CompileOutput string        `json:"compileOutput"`
	Message       string        `json:"message"`
	Status        codeRunStatus `json:"status"`
	Time          string        `json:"time"`
	Memory        int           `json:"memory"`
}

type codeRunner interface {
	Languages(context.Context) ([]codeLanguage, error)
	Run(context.Context, int, string, string) (codeRunResult, error)
}

type codeRunnerClient struct {
	endpoint string
	http     *http.Client
	logger   *slog.Logger
}

type codeRuntime struct {
	codeLanguage
	source   string
	compile  []string
	artifact string
	run      []string
}

var codeRuntimes = []codeRuntime{
	{codeLanguage: codeLanguage{ID: 1, Name: "Python"}, source: "source.py", run: []string{"/usr/bin/python3", "source.py"}},
	{codeLanguage: codeLanguage{ID: 2, Name: "JavaScript"}, source: "source.js", run: []string{"/usr/bin/node", "source.js"}},
	{codeLanguage: codeLanguage{ID: 3, Name: "TypeScript"}, source: "source.ts", compile: []string{"/usr/bin/tsc", "source.ts", "--target", "ES2022", "--module", "commonjs", "--outDir", "."}, artifact: "source.js", run: []string{"/usr/bin/node", "source.js"}},
	{codeLanguage: codeLanguage{ID: 4, Name: "C"}, source: "source.c", compile: []string{"/usr/bin/gcc", "source.c", "-O2", "-o", "program"}, artifact: "program", run: []string{"./program"}},
	{codeLanguage: codeLanguage{ID: 5, Name: "C++"}, source: "source.cpp", compile: []string{"/usr/bin/g++", "source.cpp", "-O2", "-o", "program"}, artifact: "program", run: []string{"./program"}},
	{
		codeLanguage: codeLanguage{ID: 6, Name: "Java"},
		source:       "Main.java",
		compile: []string{
			"/bin/sh", "-c",
			"/usr/lib/jvm/default-java/bin/javac -J-Xmx512m -J-XX:+UseSerialGC -J-XX:ActiveProcessorCount=2 Main.java && tar -cf classes.tar -- *.class",
		},
		artifact: "classes.tar",
		run: []string{
			"/bin/sh", "-c",
			"tar -xf classes.tar && exec /usr/lib/jvm/default-java/bin/java -Xmx256m -XX:+UseSerialGC -XX:ActiveProcessorCount=2 Main",
		},
	},
	{codeLanguage: codeLanguage{ID: 7, Name: "Go"}, source: "source.go", compile: []string{"/usr/bin/go", "build", "-o", "program", "source.go"}, artifact: "program", run: []string{"./program"}},
	{codeLanguage: codeLanguage{ID: 8, Name: "Rust"}, source: "source.rs", compile: []string{"/usr/bin/rustc", "-C", "linker=/usr/bin/gcc", "-O", "source.rs", "-o", "program"}, artifact: "program", run: []string{"./program"}},
}

type goJudgeCommand struct {
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

type goJudgeResult struct {
	Status     string            `json:"status"`
	Error      string            `json:"error"`
	ExitStatus int               `json:"exitStatus"`
	Time       int64             `json:"time"`
	Memory     int               `json:"memory"`
	Files      map[string]string `json:"files"`
	FileIDs    map[string]string `json:"fileIds"`
}

func newCodeRunnerClient(settings config.Runner, client *http.Client, logger *slog.Logger) *codeRunnerClient {
	return &codeRunnerClient{endpoint: strings.TrimRight(settings.Endpoint, "/"), http: client, logger: logger}
}

func (c *codeRunnerClient) request(ctx context.Context, method, path string, input any, output any) error {
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

func (c *codeRunnerClient) Languages(ctx context.Context) ([]codeLanguage, error) {
	languages := make([]codeLanguage, len(codeRuntimes))
	for index, runtime := range codeRuntimes {
		languages[index] = runtime.codeLanguage
	}
	return languages, nil
}

func (c *codeRunnerClient) Run(ctx context.Context, languageID int, sourceCode, stdin string) (codeRunResult, error) {
	runtime, ok := runtimeFor(languageID)
	if !ok || len(runtime.run) == 0 {
		return codeRunResult{}, fmt.Errorf("unsupported code language")
	}
	compileOutput := ""
	copyIn := map[string]map[string]any{runtime.source: {"content": sourceCode}}
	if len(runtime.compile) > 0 {
		compiled, err := c.execute(ctx, goJudgeCommand{
			Args:          runtime.compile,
			Env:           commandEnvironment(),
			Files:         commandFiles(""),
			CPULimit:      15_000_000_000,
			ClockLimit:    18_000_000_000,
			MemoryLimit:   1024 * 1024 * 1024,
			ProcLimit:     256,
			CopyIn:        copyIn,
			CopyOutCached: []string{runtime.artifact},
		})
		if err != nil {
			return codeRunResult{}, err
		}
		artifactID := compiled.FileIDs[runtime.artifact]
		if artifactID != "" {
			defer func() {
				cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
				defer cancel()
				if cleanupErr := c.request(cleanupContext, http.MethodDelete, "/file/"+url.PathEscape(artifactID), nil, nil); cleanupErr != nil {
					c.logger.WarnContext(cleanupContext, "code runner artifact cleanup failed", "artifact_id", artifactID, "error", cleanupErr)
				}
			}()
		}
		compileOutput = compiled.Files["stderr"] + compiled.Files["stdout"]
		if compiled.Status != "Accepted" {
			return codeRunResult{
				CompileOutput: compileOutput,
				Message:       compiled.Error,
				Status:        codeRunStatus{Description: "Compilation Error"},
				Time:          formatRunTime(compiled.Time),
				Memory:        compiled.Memory,
			}, nil
		}
		if artifactID == "" {
			return codeRunResult{}, fmt.Errorf("go-judge did not return compiled artifact")
		}
		copyIn = map[string]map[string]any{runtime.artifact: {"fileId": artifactID}}
	}
	result, err := c.execute(ctx, goJudgeCommand{
		Args:        runtime.run,
		Env:         commandEnvironment(),
		Files:       commandFiles(stdin),
		CPULimit:    3_000_000_000,
		ClockLimit:  6_000_000_000,
		MemoryLimit: 512 * 1024 * 1024,
		ProcLimit:   64,
		CopyIn:      copyIn,
	})
	if err != nil {
		return codeRunResult{}, err
	}
	return codeRunResult{
		Stdout:        result.Files["stdout"],
		Stderr:        result.Files["stderr"],
		CompileOutput: compileOutput,
		Message:       result.Error,
		Status:        codeRunStatus{Description: executionStatus(result.Status)},
		Time:          formatRunTime(result.Time),
		Memory:        result.Memory,
	}, nil
}

func runtimeFor(languageID int) (codeRuntime, bool) {
	if languageID < 1 || languageID > len(codeRuntimes) {
		return codeRuntime{}, false
	}
	runtime := codeRuntimes[languageID-1]
	return runtime, runtime.ID == languageID
}

func commandFiles(stdin string) []any {
	return []any{
		map[string]string{"content": stdin},
		map[string]any{"name": "stdout", "max": 1 << 20},
		map[string]any{"name": "stderr", "max": 1 << 20},
	}
}

func commandEnvironment() []string {
	return []string{"HOME=/w", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
}

func (c *codeRunnerClient) execute(ctx context.Context, command goJudgeCommand) (goJudgeResult, error) {
	var results []goJudgeResult
	if err := c.request(ctx, http.MethodPost, "/run", map[string]any{"cmd": []goJudgeCommand{command}}, &results); err != nil {
		return goJudgeResult{}, err
	}
	if len(results) != 1 {
		return goJudgeResult{}, fmt.Errorf("invalid go-judge result count")
	}
	return results[0], nil
}

func executionStatus(status string) string {
	switch status {
	case "Accepted":
		return "Completed"
	case "Time Limit Exceeded":
		return status
	default:
		return "Runtime Error"
	}
}

func formatRunTime(nanoseconds int64) string {
	formatted := strconv.FormatFloat(float64(nanoseconds)/1_000_000_000, 'f', 3, 64)
	formatted = strings.TrimRight(formatted, "0")
	return strings.TrimRight(formatted, ".")
}

func (a *application) codeLanguages(w http.ResponseWriter, r *http.Request) {
	languages, err := a.runner.Languages(r.Context())
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"languages": languages})
}

func (a *application) runCode(w http.ResponseWriter, r *http.Request) {
	var input struct {
		LanguageID int    `json:"languageId"`
		SourceCode string `json:"sourceCode"`
		Stdin      string `json:"stdin"`
	}
	if err := a.readJSON(w, r, &input); err != nil {
		a.respondError(w, err)
		return
	}
	if _, ok := runtimeFor(input.LanguageID); !ok || strings.TrimSpace(input.SourceCode) == "" {
		a.respondError(w, bad("请选择语言并输入代码"))
		return
	}
	result, err := a.runner.Run(r.Context(), input.LanguageID, input.SourceCode, input.Stdin)
	if err != nil {
		a.respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
