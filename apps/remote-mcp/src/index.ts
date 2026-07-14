import { Hono, type Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { sendTelegramMessage, telegramMessageInputSchema } from 'sendkit-core';
import { createClerkClient } from '@clerk/backend';
import { generateClerkProtectedResourceMetadata } from '@clerk/mcp-tools/server';

const clerkPublisableKey = process.env.CLERK_PUBLISHABLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!clerkPublisableKey) {
    throw new Error("CLERK_PUBLISHABLE_KEY environment variable is required.");
}

if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY environment variable is required.");
}

const clerkClient = createClerkClient({
    publishableKey: clerkPublisableKey,
    secretKey: clerkSecretKey
});


function createServer(botToken: string) {
    const server = new McpServer({
        name: "sendkit-remote",
        version: "0.0.0",
    });



    server.registerTool(
        'telegram',
        {
            title: 'Telegram',
            description: 'Send Telegram Message',
            inputSchema: telegramMessageInputSchema.shape,
        },
        async (input) => {
            const result = await sendTelegramMessage({
                ...input,
                botToken
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `Sent Telegram message ${result.messageId} to chat ${result.chatId}`,
                    }
                ],
                structuredContent: result,
            };

        }
    )

    return server;
};

const app = new Hono();

function protectedResourceMetadataUrl(c: Context, botToken: string) {
    return new URL(`/.well-known/oauth-protected-resource/${botToken}/mcp`, c.req.url).toString();
}

function unauthorizedMcpResponse(c: Context, botToken: string) {
    c.header(
        "WWW-Authenticate",
        `Bearer resource-metadata="${protectedResourceMetadataUrl(c, botToken)}"`,
    );
    return c.json({ error: "Unauthorized" }, 401);
}

app.get("/.well-known/oauth-protected-resource/:botToken/mcp", (c) => {
    return c.json(
        generateClerkProtectedResourceMetadata({
            publishableKey: clerkPublisableKey,
            resourceUrl: new URL(`/${c.req.param("botToken")}/mcp`, c.req.url).toString(),
        }),
    );
});

app.post("/:botToken/mcp", async (c) => {

    const authHeader = c.req.header("authorization");
    const botToken = c.req.param("botToken");

    console.log(authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
        return unauthorizedMcpResponse(c, botToken);
    }

    try {
        const requestState = await clerkClient.authenticateRequest(c.req.raw, {
            acceptsToken: "oauth_token",
        });

        if (!requestState.isAuthenticated) {
            return unauthorizedMcpResponse(c, botToken);
        }
    } catch (error) {
        console.error("Clerk auth error:", error);
        return unauthorizedMcpResponse(c, botToken);
    }

    const server = createServer(botToken);

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
        return await transport.handleRequest(c.req.raw);
    } finally {
        await server.close();
    }
});

app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
});


const port = Number(process.env.PORT ?? 3000);

export default {
    port,
    fetch: (req: Request) => {
        const url = new URL(req.url);
        url.protocol = req.headers.get("x-forwarded-proto") ?? url.protocol;
        url.host = req.headers.get("x-forwarded-host") ?? url.host;

        const init: RequestInit = {
            method: req.method,
            headers: req.headers,
            body: req.body,
        };
        if (req.body) {
            //@ts-expect-error - required by some runtimes for streaming bodies
            init.duplex = "half";
        }

        return app.fetch(new Request(url, init));
    },
};