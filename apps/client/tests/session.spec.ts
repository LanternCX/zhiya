import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

test.beforeEach(async ({ page }) => { await completedOnboarding(page); });

test("a session change dismisses a pending sign-out confirmation", async ({ page }) => {
  let signedIn = true;
  let exits = 0;
  await page.route("**/api/me", route => signedIn
    ? route.fulfill({ json: { id: "learner", email: "learner@example.com", nickname: "学习者", avatar: "" } })
    : route.fulfill({ status: 401, json: { error: "请登录" } }),
  );
  await page.route("**/api/auth/logout", route => {
    exits++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  signedIn = false;
  await page.evaluate(() => {
    const channel = new BroadcastChannel("zhiya-account");
    channel.postMessage("changed");
    channel.close();
  });
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(exits).toBe(0);
});

test("an obsolete verification response cannot restore a flow after the session reloads", async ({
  page,
}) => {
  let releaseResponse!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { error: "请登录。" } }),
  );
  await page.route("**/api/auth/register/start", async (route) => {
    await responseReady;
    await route.fulfill({ json: { flow: "obsolete-flow" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByRole("radio", { name: /我是学生/ }).check();
  await page.getByLabel("邮箱", { exact: true }).fill("old@example.com");
  const started = page.waitForRequest("**/api/auth/register/start");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await started;
  await page.evaluate(() => {
    const channel = new BroadcastChannel("zhiya-account");
    channel.postMessage("changed");
    channel.close();
  });
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  const completed = page.waitForResponse("**/api/auth/register/start");
  releaseResponse();
  await completed;
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "发送验证码", exact: true }),
  ).toBeVisible();
});

test("canceling navigation preserves profile edits and returns focus", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        id: "learner",
        email: "learner@example.com",
        nickname: "学习者",
        avatar: "",
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await page.getByLabel("昵称", { exact: true }).fill("未保存的昵称");
  const security = page.getByRole("button", { name: "账号安全", exact: true });
  await page.getByRole("button", { name: "用户菜单" }).click();
  await security.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
    "未保存的昵称",
  );
  await expect(page.getByRole("button", { name: "用户菜单" })).toBeFocused();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await security.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "放弃修改", exact: true })
    .click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("学习者");
});
