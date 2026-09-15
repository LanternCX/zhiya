import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadClientConfig, root } from "./config.mjs";

const [command, ...extra] = process.argv.slice(2);
const env = { ...process.env };
let executable;
let args;

if (["server", "check-server-config", "test-accounts"].includes(command)) {
  // Pass the filename to Go; Node never parses deployment configuration.
  if (env.ZHIYA_SERVER_CONFIG) {
    env.ZHIYA_SERVER_CONFIG = resolve(root, "apps/server", env.ZHIYA_SERVER_CONFIG);
  }
  executable = "go";
  args = ["-C", root + "/apps/server"];
  if (command === "test-accounts") {
    env.ZHIYA_TEST_DATABASE = "1";
    args.push("test", "-race", "./...", ...extra);
  } else {
    args.push("run", "./cmd/api",
      ...(command === "check-server-config" ? ["-check-config"] : []), ...extra);
  }
} else if (["services", "services-stop"].includes(command)) {
  executable = "docker";
  args = ["compose", "--env-file", resolve(root, env.ZHIYA_SERVICES_ENV ?? "dev-services.env"),
    ...(command === "services" ? ["up", "-d", "--wait"] : ["stop"]), ...extra];
} else {
  const { config, configPath } = loadClientConfig();
  env.ZHIYA_CLIENT_CONFIG = configPath;
  switch (command) {
    case "desktop-dev":
    case "desktop-build":
    case "desktop-test":
      if (command === "desktop-build" && !config.api_origin.startsWith("https://")) {
        throw new Error("Desktop release builds require an HTTPS client api_origin");
      }
      env.ZHIYA_BUILD_API_ORIGIN = config.api_origin;
      env.ZHIYA_BUILD_REQUEST_TIMEOUT_SECONDS = String(config.request_timeout_seconds);
      if (command === "desktop-test") {
        executable = "cargo";
        args = ["test", "--manifest-path", "apps/client/src-tauri/Cargo.toml", ...extra];
      } else {
        const websocketOrigin = config.api_origin.replace(/^http/, "ws");
        executable = "npm";
        args = ["run", "tauri", "--workspace", "@zhiya/client", "--",
          command === "desktop-dev" ? "dev" : "build",
          "--config", JSON.stringify({
            build: { devUrl: config.dev_origin },
            app: { security: { csp: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost ${websocketOrigin} https: http://127.0.0.1:* http://localhost:*` } },
          }),
          ...(command === "desktop-build" ? ["--no-bundle"] : []), ...extra];
      }
      break;
    case "client-dev":
    case "client-build":
    case "test-e2e":
      executable = "npm";
      args = ["run", { "client-dev": "dev", "client-build": "build", "test-e2e": "test:e2e" }[command],
        "--workspace", "@zhiya/client", "--", ...extra];
      break;
    case "check-client-config":
      console.log("Client configuration is valid");
      process.exit(0);
      break;
    default:
      throw new Error("Unknown development command");
  }
}
const child = spawn(executable, args, { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
