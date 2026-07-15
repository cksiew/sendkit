#!/usr/bin/env node
import { Command } from "commander";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { sendTelegramMessage } from "@ckslabs/sendkit-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const program = new Command();
const configPath = join(homedir(), ".config", "sendkit", "config.json");
const cliConfigSchema = z.object({
  telegramBotToken: z.string().min(1).optional(),
});

function writeTelegramBotToken(token: string) {
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true });
  }
  try {
    writeFileSync(
      configPath,
      JSON.stringify({
        telegramBotToken: token,
      }),
      {
        encoding: "utf-8",
      },
    );
  } catch {
    throw new Error("Saving Telegram Bot Token failed.");
  }
}

function getTelegramBotToken(): string {
  if (!existsSync(configPath)) {
    throw new Error("config.json does not exist.");
  }

  try {
    const content = readFileSync(configPath, {
      encoding: "utf-8",
    });
    const configuration = cliConfigSchema.parse(JSON.parse(content));
    if (!configuration.telegramBotToken) {
      throw new Error("token does not exist in config.json");
    }
    return configuration.telegramBotToken;
  } catch {
    throw new Error("Retrieving Telegram Bot Token failed.");
  }
}

program.name("sendkit").description("SendKit CLI backed by sendkit-core");

program
  .command("init")
  .description("Configure SendKit CLI local settings")
  .requiredOption("--telegram-bot-token <botToken>", "Telegram bot token")
  .action(async (options: { telegramBotToken: string }) => {
    writeTelegramBotToken(options.telegramBotToken);
    console.log(`Saved SendKit CLI config to ${configPath}`);
  });

program
  .command("telegram")
  .description("Send a Telegram message")
  .argument("<chatId>", "Telegram chat ID")
  .argument("<message>", "Telegram message")
  .action(async (chatId: string, message: string) => {
    const token = getTelegramBotToken();

    const result = await sendTelegramMessage({
      chatId,
      botToken: token,
      message,
    });

    console.log(JSON.stringify(result));
  });

await program.parseAsync(process.argv).catch((error: unknown) => {
  console.log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

// https://api.telegram.org/bot8935400877:AAFoidRC34tz8rYCG6nBxzJuHNAtBFxP4V4/getUpdates
