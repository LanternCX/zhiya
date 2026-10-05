import { test, expect } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

test.beforeEach(async ({ page }) => { await completedOnboarding(page); });
import type { APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { root } from "../../../scripts/config.mjs";

const services = parseEnv(readFileSync(resolve(root, process.env.ZHIYA_SERVICES_ENV ?? "dev-services.env"), "utf8"));
const mailpit = "http://" + (process.env.MAILPIT_HTTP_BIND ?? services.MAILPIT_HTTP_BIND);

async function emailCode(
  request: APIRequestContext,
  email: string,
  purpose: string,
) {
  let code = "";
  await expect
    .poll(async () => {
      const inbox = await (
        await request.get(mailpit + "/api/v1/messages")
      ).json();
      for (const message of inbox.messages) {
        if (!message.To.some((to: { Address: string }) => to.Address === email))
          continue;
        const detail = await (
          await request.get(
            `${mailpit}/api/v1/message/${message.ID}`,
          )
        ).json();
        if (!detail.Text.includes(purpose)) continue;
        code = detail.Text.match(/验证码：(\d{8})/)?.[1] ?? "";
        return code.length === 8;
      }
      return false;
    })
    .toBe(true);
  return code;
}

test("a learner can register, edit their profile, and permanently delete their account", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = `learner-${Date.now()}@example.com`;
  await page.goto("/");
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByRole("radio", { name: /我是学生/ }).check();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  const code = await emailCode(request, email, "注册账号");
  await page.getByLabel("验证码", { exact: true }).fill(code);
  const password = page.getByLabel("密码", { exact: true });
  await password.fill("1234567");
  await page.getByRole("button", { name: "完成注册", exact: true }).click();
  await expect(page.getByText("密码至少需要 8 个字符", { exact: true })).toBeVisible();
  await expect(password).toHaveAttribute("type", "password");
  const showPassword = page.getByRole("button", { name: "显示密码", exact: true });
  await expect(showPassword).toHaveText("");
  await showPassword.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("1234567");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page
    .getByLabel("密码", { exact: true })
    .fill("芽芽芽芽芽芽芽芽");
  await page.getByLabel("确认密码", { exact: true }).fill("芽芽芽芽芽芽芽芽");
  await page.getByRole("button", { name: "完成注册", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByRole("radio", { name: /我是学生/ }).check();
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("该邮箱已注册，请登录或找回密码");
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("验证码", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "忘记密码", exact: true }).click();
  await expect(page.getByRole("heading", { name: "找回密码" })).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(email);
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("芽芽芽芽芽芽芽芽");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
  await page.getByLabel("昵称", { exact: true }).fill("小芽同学");
  await page.getByRole("button", { name: "保存昵称" }).click();
  await expect(page.getByRole("status")).toContainText("昵称已保存");
  await page.reload();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
    "小芽同学",
  );
  const avatar = await page.locator(".avatar").screenshot();
  await page.getByLabel("昵称", { exact: true }).fill("尚未保存的昵称");
  await page.getByLabel("上传头像", { exact: true }).setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: avatar,
  });
  await page.getByRole("button", { name: "保存头像" }).click();
  await expect(page.getByRole("status")).toContainText("头像已保存");
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue(
    "尚未保存的昵称",
  );
  await page.reload();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(page.getByAltText("当前头像")).toBeVisible();
  await page.getByRole("button", { name: "恢复默认头像" }).click();
  await page.getByRole("button", { name: "保存头像" }).click();
  await expect(page.getByRole("status")).toContainText("头像已保存");
  await expect(page.getByAltText("当前头像")).not.toBeVisible();
  const anotherTab = await page.context().newPage();
  await anotherTab.goto("/");
  await anotherTab.getByRole("button", { name: "用户菜单" }).click();
  await anotherTab.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(
    anotherTab.getByRole("heading", { name: "个人资料" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await page
    .getByLabel("当前密码", { exact: true })
    .fill("芽芽芽芽芽芽芽芽");
  await page
    .getByLabel("密码", { exact: true })
    .fill("A-changed-test-password-123");
  await page.getByLabel("确认密码", { exact: true }).fill("A-changed-test-password-123");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  await expect(
    anotherTab.getByRole("heading", { name: "登录知芽" }),
  ).toBeVisible();
  await anotherTab.close();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("A-changed-test-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await page.getByRole("button", { name: "更换邮箱", exact: true }).click();
  const newEmail = `changed-${Date.now()}@example.com`;
  await page.getByLabel("新邮箱", { exact: true }).fill(newEmail);
  await page.getByRole("button", { name: "发送两封验证邮件" }).click();
  await page
    .getByLabel("原邮箱验证码")
    .fill(await emailCode(request, email, "验证原邮箱"));
  await page
    .getByLabel("新邮箱验证码")
    .fill(await emailCode(request, newEmail, "验证新邮箱"));
  await page.getByRole("button", { name: "确认更换邮箱" }).click();
  await expect(page.getByRole("status")).toContainText("邮箱已更换");
  await page.getByRole("button", { name: "退出全部设备", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "退出全部设备", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  await page.getByRole("button", { name: "忘记密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(newEmail);
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await page
    .getByLabel("验证码", { exact: true })
    .fill(await emailCode(request, newEmail, "重设密码"));
  await page
    .getByLabel("密码", { exact: true })
    .fill("A-recovered-test-password-123");
  await page.getByLabel("确认密码", { exact: true }).fill("A-recovered-test-password-123");
  await page.getByRole("button", { name: "重设密码", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  await page.getByLabel("邮箱", { exact: true }).fill(newEmail);
  await page
    .getByLabel("密码", { exact: true })
    .fill("A-recovered-test-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await page.getByRole("button", { name: "注销账号", exact: true }).click();
  await page
    .getByLabel("当前密码", { exact: true })
    .fill("A-recovered-test-password-123");
  await page.getByLabel("我确认永久删除账号及关联个人数据，且无法恢复").check();
  await page.getByRole("button", { name: "永久注销账号" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "永久注销账号", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录知芽" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("账号已注销");
});

test("network failure offers retry instead of pretending to sign out", async ({
  page,
}) => {
  await page.route("**/api/me", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "登录知芽" }),
  ).not.toBeVisible();
});
