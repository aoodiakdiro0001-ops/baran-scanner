const { ethers } = require("ethers");
const http = require("http");

const PORT = process.env.PORT || 10000;
const RPC_URLS = [
    process.env.RPC_URL || "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://1rpc.io/base"
];
let rpcIndex = 0;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : "";
const RENDER_EXTERNAL_URL = "https://baran-scanner.onrender.com";
const ADMIN_CHAT_ID = "589920599";
const allowedUsers = new Set([ADMIN_CHAT_ID, 589920599, "589920599", Number(ADMIN_CHAT_ID)]);

if (!TELEGRAM_BOT_TOKEN) {
    console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN is missing in environment variables!");
} else {
    console.log("Loaded Telegram Token Successfully. Prefix:", TELEGRAM_BOT_TOKEN.substring(0, 10) + "...");
}

function getProvider() {
    return new ethers.JsonRpcProvider(RPC_URLS[rpcIndex]);
}

let provider = getProvider();

function rotateRpc() {
    rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
    provider = new ethers.JsonRpcProvider(RPC_URLS[rpcIndex]);
    console.log(`Switched to fallback RPC endpoint index ${rpcIndex}: ${RPC_URLS[rpcIndex]}`);
}

const ROUTER_BASESWAP = "0x327Df1Ede4564DDf2Bf58fD50C4f6Facd6557cd8";
const ROUTER_ALIENBASE = "0x16345EA9518e3881477F5C7C3E29EB3e717D5c7d";

const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const WETH = "0x4200000000000000000000000000000000000006";

const TARGET_TOKENS = [
    { name: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { name: "DEGEN", address: "0x4ed4E862860b21aae1d87fb1d459dc28f1e7bc8c", decimals: 18 },
    { name: "CBETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 }
];

const TRADE_AMOUNT = ethers.parseUnits("0.001", 18);
const ESTIMATED_GAS_UNITS = 180000n;

let lastScannedBlock = 0;
let totalScansCount = 0;

async function sendTelegramMessage(chatId, message) {
    if (!TELEGRAM_BOT_TOKEN) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: "Markdown"
            })
        });
    } catch (error) {
        console.error("Telegram Dispatch Error:", error.message);
    }
}

async function setupTelegramWebhook() {
    if (!TELEGRAM_BOT_TOKEN) return;
    try {
        const webhookUrl = `${RENDER_EXTERNAL_URL}/telegram-webhook`;
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`;
        const res = await fetch(url);
        const data = await res.json();
        console.log("Webhook setup response:", data);
    } catch (err) {
        console.error("Failed to setup webhook:", err.message);
    }
}

async function handleTelegramUpdate(update) {
    if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        const chatIdStr = chatId.toString();
        const chatIdNum = Number(chatId);
        console.log(`Received command from chat ${chatIdStr}: ${text}`);

        if (!allowedUsers.has(chatIdStr) && !allowedUsers.has(chatIdNum) && chatIdStr !== ADMIN_CHAT_ID) {
            await sendTelegramMessage(chatId, `🔒 *Access Denied*\nYour Telegram Chat ID is: \`${chatIdStr}\`\nUpdate ADMIN_CHAT_ID in your code with this number.`);
            return;
        }

        if (text === "/status") {
            const statusMsg = `🟢 *Baran Micro-SaaS Status*\n\n` +
                `- State: Live & Secured (Webhook Mode)\n` +
                `- Last Block: ${lastScannedBlock}\n` +
                `- Total Scans: ${totalScansCount}\n` +
                `- Active RPC: ${RPC_URLS[rpcIndex]}\n` +
                `- Capital Profile: Micro ($11 Base Optimized)`;
            await sendTelegramMessage(chatId, statusMsg);
        } else if (text === "/scan") {
            await sendTelegramMessage(chatId, `🔍 Executing immediate micro-scan...`);
            await scanMarketOpportunities(true, chatId);
        } else if (text === "/help") {
            const helpMsg = `🤖 *Baran Bot Commands*\n\n` +
                `/status - Check system health\n` +
                `/scan - Trigger manual scan\n` +
                `/help - Show available commands`;
            await sendTelegramMessage(chatId, helpMsg);
        } else {
            await sendTelegramMessage(chatId, `❓ Unknown command. Use /help to see available commands.`);
        }
    }
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/telegram-webhook') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const update = JSON.parse(body);
                await handleTelegramUpdate(update);
            } catch (e) {
                console.error('Error parsing webhook body:', e);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
    } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Baran Micro-SaaS Base Engine is active (Webhook Mode)!\n");
    }
});

server.listen(PORT, () => {
    console.log(`HTTP server is listening on port ${PORT}`);
    setupTelegramWebhook();
});

async function scanMarketOpportunities(isManualTrigger = false, manualChatId = null) {
    try {
        totalScansCount++;
        const currentBlock = await provider.getBlockNumber();
        lastScannedBlock = currentBlock;

        const baseSwapContract = new ethers.Contract(ROUTER_BASESWAP, ROUTER_ABI, provider);
        const alienBaseContract = new ethers.Contract(ROUTER_ALIENBASE, ROUTER_ABI, provider);

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("0.01", 9);
        const gasCostInWeth = gasPrice * ESTIMATED_GAS_UNITS;

        for (const token of TARGET_TOKENS) {
            try {
                const pathForward = [WETH, token.address];

                let amountsBaseSwap = null;
                let amountsAlienBase = null;

                try {
                    amountsBaseSwap = await baseSwapContract.getAmountsOut(TRADE_AMOUNT, pathForward);
                } catch (e) {}

                try {
                    amountsAlienBase = await alienBaseContract.getAmountsOut(TRADE_AMOUNT, pathForward);
                } catch (e) {}

                if (!amountsBaseSwap || !amountsAlienBase) continue;

                const outputBaseSwap = amountsBaseSwap[1];
                const outputAlienBase = amountsAlienBase[1];

                let grossProfit = 0n;
                let executionRoute = "";

                if (outputBaseSwap > outputAlienBase) {
                    grossProfit = outputBaseSwap - outputAlienBase;
                    executionRoute = "Buy on AlienBase ➔ Sell on BaseSwap";
                } else {
                    grossProfit = outputAlienBase - outputBaseSwap;
                    executionRoute = "Buy on BaseSwap ➔ Sell on AlienBase";
                }

                let wethToTokenRate = ethers.parseUnits("1", token.decimals);
                try {
                    const rateAmounts = await baseSwapContract.getAmountsOut(ethers.parseUnits("1.0", 18), pathForward);
                    wethToTokenRate = rateAmounts[1];
                } catch (e) {}

                const gasCostInToken = (gasCostInWeth * wethToTokenRate) / ethers.parseUnits("1.0", 18);
                const netProfit = grossProfit - gasCostInToken;

                const minNetProfitThreshold = token.name === "USDC" ? ethers.parseUnits("0.005", token.decimals) : ethers.parseUnits("0.1", token.decimals);

                if (netProfit > minNetProfitThreshold) {
                    const alertText =
                        `🚀 *Baran Micro-Arbitrage Signal (${token.name})!*\n\n` +
                        `📍 *Route:* ${executionRoute}\n` +
                        `💰 *Gross Spread:* ${ethers.formatUnits(grossProfit, token.decimals)} ${token.name}\n` +
                        `⛽ *Gas Cost:* ${ethers.formatUnits(gasCostInToken, token.decimals)} ${token.name}\n` +
                        `✨ *Net Profit:* \`${ethers.formatUnits(netProfit, token.decimals)} ${token.name}\`\n` +
                        `🌐 *Block:* ${currentBlock}`;

                    console.log(alertText);
                    await sendTelegramMessage(ADMIN_CHAT_ID, alertText);
                }
            } catch (errToken) {}
        }

        if (isManualTrigger && manualChatId) {
            const reportText = `📊 *Micro-SaaS Manual Scan Report*\n\n` +
                `- Current Block: ${currentBlock}\n` +
                `- Total Scans: ${totalScansCount}\n` +
                `- Status: Budget optimized ($11 capital profile active).`;
            await sendTelegramMessage(manualChatId, reportText);
        } else {
            console.log(`Scanning block ${currentBlock} with optimized micro-budget... Engine operating smoothly.`);
        }

    } catch (error) {
        console.error("Scanner Loop Error:", error.message);
        rotateRpc();
    }
}

console.log("Baran Command Center & Micro-SaaS Engine Initializing (Webhook Architecture)...");
const scannerInterval = setInterval(() => scanMarketOpportunities(false), 4000);

process.on('SIGTERM', () => {
    clearInterval(scannerInterval);
    server.close(() => {
        console.log("Server terminated gracefully.");
        process.exit(0);
    });
});