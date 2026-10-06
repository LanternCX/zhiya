// Command knowledge imports existing offline embeddings or queries the corpus.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/LanternCX/zhiya/apps/server/internal/knowledge"
	"github.com/LanternCX/zhiya/apps/server/internal/materialparse"
	"github.com/LanternCX/zhiya/apps/server/internal/objectstore"
)

type directories []string

func (d *directories) String() string         { return fmt.Sprint([]string(*d)) }
func (d *directories) Set(value string) error { *d = append(*d, value); return nil }

func main() {
	data := flag.String("data-dir", "", "prepared corpus directory")
	replaceText := flag.Bool("replace-text", false, "replace the active text index with completed offline embeddings")
	uploadObjects := flag.Bool("upload-objects", false, "upload corpus files and write --catalog using knowledge_storage configuration")
	describeTargets := flag.Bool("describe-targets", false, "print destination names without credentials or storage writes")
	catalog := flag.String("catalog", "", "catalog.json matching the uploaded corpus")
	project := flag.String("knowledge-project", "../knowledge", "offline Python tool directory")
	var embeddings directories
	flag.Var(&embeddings, "embedding-dir", "completed offline embedding directory; repeat for each route")
	query := flag.String("query", "", "search the active corpus instead of importing")
	read := flag.String("read", "", "read source evidence as version/blockId")
	check := flag.Bool("check-model", false, "verify the configured query API with one text input")
	route := flag.String("route", "visual", "embedding route for --check-model: text or visual")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := config.LoadDefault(".")
	if err != nil {
		fail("configuration loading failed: " + err.Error())
	}
	if *describeTargets {
		database, _ := url.Parse(cfg.KnowledgeDatabase.URL)
		endpoint, _ := url.Parse(cfg.KnowledgeStorage.Endpoint)
		endpoint.User, endpoint.RawQuery, endpoint.Fragment = nil, "", ""
		json.NewEncoder(os.Stdout).Encode(map[string]string{"database_host": database.Host, "database_name": database.Path[1:], "object_endpoint": endpoint.String(), "object_bucket": cfg.KnowledgeStorage.Bucket})
		return
	}
	if *uploadObjects {
		if *data == "" || *catalog == "" {
			fail("--upload-objects requires --data-dir and --catalog")
		}
		if _, err := objectstore.New(ctx, cfg.KnowledgeStorage); err != nil {
			fail("knowledge bucket initialization failed")
		}
		absolute, err := filepath.Abs(*data)
		if err != nil {
			fail("invalid corpus path")
		}
		destination, err := filepath.Abs(*catalog)
		if err != nil {
			fail("invalid catalog path")
		}
		command := exec.CommandContext(ctx, "uv", "run", "--locked", "--project", *project, "--with", "boto3", "python", "-m", "preparation.publish_objects", "--data-dir", absolute, "--catalog-out", destination, "--endpoint", cfg.KnowledgeStorage.Endpoint, "--bucket", cfg.KnowledgeStorage.Bucket, "--region", cfg.KnowledgeStorage.Region)
		command.Env = append(os.Environ(), "AWS_ACCESS_KEY_ID="+cfg.KnowledgeStorage.AccessKey, "AWS_SECRET_ACCESS_KEY="+cfg.KnowledgeStorage.SecretKey)
		command.Stdout, command.Stderr = os.Stdout, os.Stderr
		if err := command.Run(); err != nil {
			fail("corpus upload failed")
		}
		return
	}
	textEncoder := knowledge.NewEncoder(cfg.KnowledgeTextModel.Endpoint, cfg.KnowledgeTextModel.ID, cfg.KnowledgeTextModel.APIKey, http.DefaultClient)
	visualEncoder := knowledge.NewEncoder(cfg.KnowledgeVisualModel.Endpoint, cfg.KnowledgeVisualModel.ID, cfg.KnowledgeVisualModel.APIKey, http.DefaultClient)
	if *check {
		encoder := visualEncoder
		switch *route {
		case "text":
			encoder = textEncoder
		case "visual":
		default:
			fail("--route must be text or visual")
		}
		vector, err := encoder.Embed(ctx, map[string]string{"text": "人工智能训练数据"})
		if err != nil {
			fail(err.Error())
		}
		fmt.Printf("%s Query API verified: %d dimensions\n", *route, len(vector))
		return
	}
	repository, err := knowledge.OpenDatabase(ctx, cfg.KnowledgeDatabase.URL)
	if err != nil {
		fail("knowledge database initialization failed: " + err.Error())
	}
	defer repository.Pool.Close()
	objects, err := objectstore.New(ctx, cfg.KnowledgeStorage)
	if err != nil {
		fail("knowledge bucket initialization failed")
	}
	if *query != "" || *read != "" {
		service := knowledge.Service{Repository: repository, Objects: objects, TextEncoder: textEncoder, VisualEncoder: visualEncoder, Parser: materialparse.New(cfg.MaterialParser.Endpoint, cfg.VisionModel.Endpoint, cfg.VisionModel.ID, cfg.VisionModel.APIKey, http.DefaultClient)}
		if *query != "" {
			sources, err := service.Search(ctx, *query, 5)
			if err != nil {
				fail(err.Error())
			}
			json.NewEncoder(os.Stdout).Encode(sources)
			return
		}
		var version, id string
		for i, c := range *read {
			if c == '/' {
				version = (*read)[:i]
				id = (*read)[i+1:]
				break
			}
		}
		if version == "" || id == "" {
			fail("--read must be version/blockId")
		}
		source, err := service.Read(ctx, version, id)
		if err != nil {
			fail(err.Error())
		}
		json.NewEncoder(os.Stdout).Encode(source)
		return
	}
	if (!*replaceText && (*data == "" || *catalog == "")) || len(embeddings) == 0 || (*replaceText && len(embeddings) != 1) {
		fail("--data-dir, --catalog and --embedding-dir are required; import never generates embeddings")
	}
	options := knowledge.ImportOptions{CatalogPath: *catalog, Progress: func(stage string, completed, total int) {
		fmt.Fprintf(os.Stderr, "%s %d/%d\n", stage, completed, total)
	}}
	for _, dir := range embeddings {
		absolute, err := filepath.Abs(dir)
		if err != nil {
			fail("invalid embedding path")
		}
		reader, writer := io.Pipe()
		command := exec.CommandContext(ctx, "uv", "run", "--locked", "--project", *project, "python", "-m", "embedding.retrieval_export", "--embedding-dir", absolute)
		command.Stdout = writer
		command.Stderr = os.Stderr
		go func() { writer.CloseWithError(command.Run()) }()
		defer reader.Close()
		options.Embeddings = append(options.Embeddings, reader)
	}
	if *replaceText {
		result, err := knowledge.ReplaceTextEmbeddings(ctx, repository, options.Embeddings[0], func(count int) {
			fmt.Fprintf(os.Stderr, "text_vectors %d\n", count)
		})
		if err != nil {
			fail(err.Error())
		}
		json.NewEncoder(os.Stdout).Encode(result)
		return
	}
	result, err := knowledge.Import(ctx, *data, repository, objects, options)
	if err != nil {
		fail(err.Error())
	}
	json.NewEncoder(os.Stdout).Encode(result)
}
func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
