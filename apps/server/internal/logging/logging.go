// Package logging configures the server's structured machine and console logs.
package logging

import (
	"bufio"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
)

type consoleHandler struct {
	output io.Writer
	level  slog.Leveler
	color  bool
	attrs  []consoleAttr
	groups []string
	mu     *sync.Mutex
}

type consoleAttr struct {
	attr   slog.Attr
	groups []string
}

type observedResponse struct {
	http.ResponseWriter
	logger      *slog.Logger
	status      int
	wroteHeader bool
}

// New creates a logger for the configured deployment format.
func New(output io.Writer, settings config.Logging) *slog.Logger {
	level := map[string]slog.Level{
		"debug": slog.LevelDebug,
		"info":  slog.LevelInfo,
		"warn":  slog.LevelWarn,
		"error": slog.LevelError,
	}[settings.Level]
	if settings.Format == "json" {
		return slog.New(slog.NewJSONHandler(output, &slog.HandlerOptions{Level: level}))
	}
	return slog.New(newConsoleHandler(output, level, consoleColors(output)))
}

func newConsoleHandler(output io.Writer, level slog.Leveler, color bool) *consoleHandler {
	return &consoleHandler{output: output, level: level, color: color, mu: &sync.Mutex{}}
}

func consoleColors(output io.Writer) bool {
	if _, disabled := os.LookupEnv("NO_COLOR"); disabled || os.Getenv("TERM") == "dumb" {
		return false
	}
	file, ok := output.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func (h *consoleHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level.Level()
}

func (h *consoleHandler) Handle(_ context.Context, record slog.Record) error {
	var line strings.Builder
	if !record.Time.IsZero() {
		line.WriteString(record.Time.Format("15:04:05"))
		line.WriteByte(' ')
	}
	label := fmt.Sprintf("%-5s", record.Level.String())
	if h.color {
		line.WriteString(levelColor(record.Level))
		line.WriteString(label)
		line.WriteString("\x1b[0m")
	} else {
		line.WriteString(label)
	}
	line.WriteByte(' ')
	line.WriteString(record.Message)
	for _, attr := range h.attrs {
		appendConsoleAttr(&line, attr.groups, attr.attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		appendConsoleAttr(&line, h.groups, attr)
		return true
	})
	line.WriteByte('\n')

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(h.output, line.String())
	return err
}

func (h *consoleHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	clone := *h
	clone.attrs = append([]consoleAttr(nil), h.attrs...)
	for _, attr := range attrs {
		clone.attrs = append(clone.attrs, consoleAttr{attr: attr, groups: append([]string(nil), h.groups...)})
	}
	return &clone
}

func (h *consoleHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	clone := *h
	clone.groups = append(append([]string(nil), h.groups...), name)
	return &clone
}

func levelColor(level slog.Level) string {
	switch {
	case level >= slog.LevelError:
		return "\x1b[31m"
	case level >= slog.LevelWarn:
		return "\x1b[33m"
	case level >= slog.LevelInfo:
		return "\x1b[32m"
	default:
		return "\x1b[36m"
	}
}

func appendConsoleAttr(line *strings.Builder, groups []string, attr slog.Attr) {
	attr.Value = attr.Value.Resolve()
	if attr.Equal(slog.Attr{}) {
		return
	}
	if attr.Value.Kind() == slog.KindGroup {
		nested := groups
		if attr.Key != "" {
			nested = append(append([]string(nil), groups...), attr.Key)
		}
		for _, child := range attr.Value.Group() {
			appendConsoleAttr(line, nested, child)
		}
		return
	}
	key := strings.Join(append(append([]string(nil), groups...), attr.Key), ".")
	line.WriteByte(' ')
	line.WriteString(key)
	line.WriteByte('=')
	line.WriteString(consoleValue(attr.Value))
}

func consoleValue(value slog.Value) string {
	switch value.Kind() {
	case slog.KindString:
		return quoteConsoleString(value.String())
	case slog.KindBool:
		return strconv.FormatBool(value.Bool())
	case slog.KindInt64:
		return strconv.FormatInt(value.Int64(), 10)
	case slog.KindUint64:
		return strconv.FormatUint(value.Uint64(), 10)
	case slog.KindFloat64:
		return strconv.FormatFloat(value.Float64(), 'g', -1, 64)
	case slog.KindDuration:
		return value.Duration().String()
	case slog.KindTime:
		return value.Time().Format(time.RFC3339Nano)
	default:
		return quoteConsoleString(fmt.Sprint(value.Any()))
	}
}

func quoteConsoleString(value string) string {
	if value == "" {
		return `""`
	}
	for _, character := range value {
		if unicode.IsSpace(character) || unicode.IsControl(character) || character == '=' || character == '"' || character == '\\' {
			return strconv.Quote(value)
		}
	}
	return value
}

func (w *observedResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *observedResponse) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	connection, buffered, err := http.NewResponseController(w.ResponseWriter).Hijack()
	if err == nil {
		w.status = http.StatusSwitchingProtocols
		w.wroteHeader = true
	}
	return connection, buffered, err
}

func (w *observedResponse) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *observedResponse) Write(content []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(content)
}

// ForResponse returns the request-scoped logger when w was wrapped by HTTPMiddleware.
func ForResponse(w http.ResponseWriter, fallback *slog.Logger) *slog.Logger {
	if response, ok := w.(*observedResponse); ok {
		return response.logger
	}
	return fallback
}

// HTTPMiddleware records request completion and recovers handler panics.
func HTTPMiddleware(logger *slog.Logger, panicResponse func(http.ResponseWriter)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			requestID := rand.Text()
			requestLogger := logger.With("request_id", requestID)
			response := &observedResponse{ResponseWriter: w, logger: requestLogger, status: http.StatusOK}
			response.Header().Set("X-Request-ID", requestID)

			defer func() {
				if recovered := recover(); recovered != nil {
					requestLogger.ErrorContext(r.Context(), "request panicked", "panic", fmt.Sprint(recovered), "stack", string(debug.Stack()))
					if !response.wroteHeader {
						panicResponse(response)
					}
				}
				requestLogger.InfoContext(r.Context(), "http request completed",
					"method", r.Method,
					"route", r.Pattern,
					"status", response.status,
					"duration_ms", time.Since(started).Milliseconds(),
				)
			}()

			next.ServeHTTP(response, r)
		})
	}
}
