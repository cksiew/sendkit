import { Command } from 'commander';
import { sendTelegramMessage } from 'sendkit-core';


const program = new Command();

program
    .name("sendkit")
    .description("SendKit tutorial CLI")
    .command("telegram")
    .description("Send a Telegram message")
    .argument("<chatId>", "Telegram chat ID")
    .argument("<message>", "Telegram message")
    .action(async (chatId: string, message: string) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;

        if (!token) {
            console.error("Missing TELEGRAM_BOT_TOKEN environment variable.");
            process.exit(1);
        }
        if (!chatId) {
            console.error("Missing Telegram chat ID.");
            process.exit(1);
        }
        if (!message) {
            console.error("Missing Telegram message text.");
            process.exit(1);
        }

        try {
            const result = await sendTelegramMessage({
                chatId,
                botToken: token,
                message
            });

            console.log(`Sent Telegram message to chat ${result.chatId}`);
            console.log(`Telegram message ID: ${result.messageId}`);
        } catch (error: any) {
            const detail = error instanceof Error ? error.message : String(error);
            console.error(`Telegram API request failed: ${detail}`);
            process.exit(1);
        }







    });

program.parseAsync(process.argv)

// https://api.telegram.org/bot8935400877:AAFoidRC34tz8rYCG6nBxzJuHNAtBFxP4V4/getUpdates