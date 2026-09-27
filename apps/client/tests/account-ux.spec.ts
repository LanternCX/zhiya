import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

test.beforeEach(async ({ page }) => { await completedOnboarding(page); });

test("password fields use one reveal control and preserve the value when toggled", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "请登录" } }));
  await page.route("**/api/auth/register/start", route => route.fulfill({ json: { flow: "registration" } }));
  await page.goto("/");

  async function checkPassword(label: string) {
    const input = page.getByLabel(label, { exact: true });
    // Typing while focused makes Edge's native reveal control appear.
    await input.pressSequentially("my-password");
    await expect(input).toHaveAttribute("type", "password");
    if (await page.evaluate(() => CSS.supports("selector(input::-ms-reveal)"))) {
      // Native controls live in the browser's closed shadow DOM.
      const session = await page.context().newCDPSession(page);
      try {
        await session.send("DOM.enable");
        await session.send("CSS.enable");
        const { nodes } = await session.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
        const reveals = nodes.filter(node => node.attributes?.includes("-ms-reveal"));
        expect(reveals.length).toBeGreaterThan(0);
        for (const { nodeId } of reveals) {
          const { computedStyle } = await session.send("CSS.getComputedStyleForNode", { nodeId });
          expect(computedStyle.find(property => property.name === "display")?.value).toBe("none");
        }
      } finally {
        await session.detach();
      }
    }
    const show = page.getByRole("button", { name: `显示${label}`, exact: true });
    await expect(show).toHaveCount(1);
    await show.click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveValue("my-password");
    await page.getByRole("button", { name: `隐藏${label}`, exact: true }).click();
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue("my-password");
  }

  await checkPassword("密码");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("learner@example.com");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await checkPassword("密码");
  await checkPassword("确认密码");
  await expect(page.getByRole("img", { name: "两次输入一致" })).toBeVisible();
});

test("verification can expire and be resent without losing the chosen password", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "请登录" } }));
  await page.route("**/api/account-rules", route => route.fulfill({ json: {
    password_min_characters: 8, password_max_bytes: 256, nickname_max_characters: 40,
    avatar_max_bytes: 2097152, avatar_max_dimension: 2048, verification_code_digits: 8, verification_ttl_seconds: 60,
  } }));
  let sent = 0;
  await page.route("**/api/auth/register/start", route => {
    sent++;
    return sent === 2
      ? route.fulfill({ status: 503, json: { error: "服务暂时不可用，请稍后重试" } })
      : route.fulfill({ json: { flow: `flow-${sent}` } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("learner@example.com");
  await page.clock.install();
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await page.getByLabel("密码", { exact: true }).fill("my-password");
  await page.getByLabel("确认密码", { exact: true }).fill("my-password");
  await page.getByLabel("验证码", { exact: true }).fill("12345678");
  await expect(page.getByRole("button", { name: /秒后可重新发送/ })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByText("验证码已过期，请重新发送", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "完成注册", exact: true })).toBeDisabled();
  const resend = page.getByRole("button", { name: "重新发送验证码", exact: true });
  await resend.click();
  await expect(page.getByRole("alert")).toContainText("服务暂时不可用");
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("my-password");
  await resend.click();
  await expect(page.getByLabel("验证码", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("my-password");
  await expect(page.getByLabel("确认密码", { exact: true })).toHaveValue("my-password");
  await expect(page.getByText("验证码已过期，请重新发送", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "更换邮箱", exact: true }).click();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue("learner@example.com");
  expect(sent).toBe(3);
});

test("sign out requires confirmation, supports Escape, and preserves edits on cancel", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: { id: "learner", email: "learner@example.com", nickname: "学习者", avatar: "" } }));
  let exits = 0;
  await page.route("**/api/auth/logout", route => {
    exits++;
    return route.fulfill({ status: 503, json: { error: "服务暂时不可用，请稍后重试" } });
  });
  await page.goto("/");
  const logout = page.getByRole("button", { name: "退出登录", exact: true });
  await page.getByRole("button", { name: "用户菜单" }).click();
  await logout.click();
  const dialog = page.getByRole("dialog", { name: "退出登录？" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "退出登录", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "用户菜单" })).toBeFocused();
  expect(exits).toBe(0);
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await page.getByLabel("昵称", { exact: true }).fill("未保存");
  await page.getByRole("button", { name: "用户菜单" }).click();
  await logout.click();
  await expect(dialog).toContainText("尚未保存");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("未保存");
  await page.getByRole("button", { name: "用户菜单" }).click();
  await logout.click();
  await dialog.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("alert")).toContainText("服务暂时不可用");
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("未保存");
  expect(exits).toBe(1);
});

test("permanent deletion waits for final confirmation and cancellation is harmless", async ({ page }) => {
  let deleted = false;
  await page.route("**/api/me", route => {
    if (route.request().method() === "DELETE") {
      deleted = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { id: "learner", email: "learner@example.com", nickname: "学习者", avatar: "" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await page.getByRole("button", { name: "注销账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "注销后无法恢复" })).not.toBeVisible();
  await page.getByLabel("当前密码", { exact: true }).fill("my-password");
  await page.getByRole("button", { name: "永久注销账号", exact: true }).click();
  await expect(page.getByText("请先确认注销后无法恢复", { exact: true })).toBeVisible();
  expect(deleted).toBe(false);
  await page.getByLabel("我确认永久删除账号及关联个人数据，且无法恢复").check();
  await page.getByRole("button", { name: "永久注销账号", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "永久注销账号？" });
  await expect(dialog).toContainText("无法恢复");
  expect(deleted).toBe(false);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue("my-password");
  await page.getByRole("button", { name: "永久注销账号", exact: true }).click();
  await dialog.getByRole("button", { name: "永久注销账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  expect(deleted).toBe(true);
});

test("email and verification errors appear beside fields and clear after correction", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "请登录" } }));
  const emails: string[] = [];
  await page.route("**/api/auth/register/start", route => {
    emails.push(route.request().postDataJSON().email);
    return route.fulfill({ json: { flow: "registration" } });
  });
  let submitted = false;
  await page.route("**/api/auth/register/complete", route => {
    submitted = true;
    return route.fulfill({ status: 400, json: { error: "验证码无效或已过期，请重新获取" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  const email = page.getByLabel("邮箱", { exact: true });
  await expect(email).not.toHaveAttribute("aria-invalid", "true");
  await email.fill("learner@");
  await email.press("Tab");
  await expect(page.getByText("请输入有效的邮箱地址，例如 name@example.com", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(email).toBeFocused();
  expect(emails).toHaveLength(0);
  await email.fill(" Learner+school@Example.com ");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByLabel("验证码", { exact: true })).toBeVisible();
  expect(emails).toEqual(["learner+school@example.com"]);
  const code = page.getByLabel("验证码", { exact: true });
  await code.fill("1234abcd");
  await page.getByLabel("密码", { exact: true }).fill("a-long-password");
  await page.getByLabel("确认密码", { exact: true }).fill("a-long-password");
  await page.getByRole("button", { name: "完成注册", exact: true }).click();
  await expect(page.getByText("请输入 8 位数字验证码", { exact: true })).toBeVisible();
  await expect(code).toBeFocused();
  expect(submitted).toBe(false);
  await code.fill("12345678");
  await expect(code).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "完成注册", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("验证码无效或已过期");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("a-long-password");
});

test("registration explains password rules and requires matching passwords before sending", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, json: { error: "请登录" } }));
  await page.route("**/api/auth/register/start", route => route.fulfill({ json: { flow: "registration" } }));
  const submissions: unknown[] = [];
  await page.route("**/api/auth/register/complete", route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("learner@example.com");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByText("至少 8 个字符", { exact: true })).toBeVisible();
  await page.getByLabel("验证码", { exact: true }).fill("12345678");
  const password = page.getByLabel("密码", { exact: true });
  const confirmation = page.getByLabel("确认密码", { exact: true });
  await password.fill("🌱🌱🌱🌱");
  await confirmation.fill("🌱🌱🌱🌱");
  await page.getByRole("button", { name: "完成注册", exact: true }).click();
  await expect(page.getByText("密码至少需要 8 个字符", { exact: true })).toBeVisible();
  await expect(password).toBeFocused();
  expect(submissions).toHaveLength(0);
  await password.fill("芽芽芽芽芽芽芽芽");
  await expect(page.getByText("密码符合要求", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("list", { name: "密码要求" }).getByRole("listitem").filter({ hasText: "已满足：" })).toHaveCount(2);
  await expect(page.getByText("两次输入的密码不一致", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "完成注册", exact: true }).click();
  await expect(confirmation).toBeFocused();
  expect(submissions).toHaveLength(0);
  await password.fill("🌱".repeat(65));
  await expect(password).toHaveValue("🌱".repeat(65));
  await expect(page.getByText("密码太长，请缩短后重试", { exact: true })).toBeVisible();
  await password.fill("🌱".repeat(64));
  await confirmation.fill("🌱".repeat(64));
  await expect(page.getByRole("img", { name: "两次输入一致" })).toBeVisible();
  await page.getByRole("button", { name: "完成注册", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  expect(submissions).toEqual([{ flow: "registration", code: "12345678", password: "🌱".repeat(64) }]);
});
