const { ethers } = require("ethers");
const http = require("http");

// خادم HTTP مصغر لتلبية متطلبات منصة Render
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Baran Micro-Inefficiency Engine is active and running!\n");
});
server.listen(PORT, () => {
    console.log(`HTTP server is listening on port ${PORT}`);
});

const RPC_URL = process.env.RPC_URL || "https://api.avax.network/ext/bc/C/rpc";
const TELEGRAM_BOT_TOKEN = "8750924124:AAHMXaJlzI8iHLSzdrDmWjYJNE6wDaH072M";
const TELEGRAM_CHAT_ID = "589920599";

const provider = new ethers.JsonRpcProvider(RPC_URL);

const ROUTER_TRADER_JOE = "0x60ae616a2155ee3d9a68541ba4544862310933d4";
const ROUTER_PANGOLIN = "0xe54ca86531e17ef3616d22ca28b0d458b6c81616";

const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const WAVAX = "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7";
const USDT = "0x9702230a8ea53601f5cd2dc00fdbc13d4d4a84fd";

const TRADE_AMOUNT = ethers.parseUnits("1.0", 18); // حجم التداول التجريبي (1 AVAX)
const ESTIMATED_GAS_UNITS = 250000n; // تقدير استهلاك الغاز لمعاملة الأربيتراج المزدوجة

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "Markdown"
            })
        });
    } catch (error) {
        console.error("Telegram Dispatch Error:", error.message);
    }
}

async function scanMarketOpportunities() {
    try {
        const traderJoeContract = new ethers.Contract(ROUTER_TRADER_JOE, ROUTER_ABI, provider);
        const pangolinContract = new ethers.Contract(ROUTER_PANGOLIN, ROUTER_ABI, provider);

        const pathForward = [WAVAX, USDT];

        let amountsJoe = null;
        let amountsPangolin = null;

        try {
            amountsJoe = await traderJoeContract.getAmountsOut(TRADE_AMOUNT, pathForward);
        } catch (err) {}

        try {
            amountsPangolin = await pangolinContract.getAmountsOut(TRADE_AMOUNT, pathForward);
        } catch (err) {}

        if (!amountsJoe || !amountsPangolin) {
            console.log("Scanning block... Insufficient liquidity on one or more DEXes.");
            return;
        }

        const outputJoe = amountsJoe[1];
        const outputPangolin = amountsPangolin[1];

        let grossProfit = 0n;
        let executionRoute = "";

        if (outputJoe > outputPangolin) {
            grossProfit = outputJoe - outputPangolin; // بالـ USDT (6 خانات عشرية)
            executionRoute = "Buy on Pangolin ➔ Sell on Trader Joe";
        } else {
            grossProfit = outputPangolin - outputJoe;
            executionRoute = "Buy on Trader Joe ➔ Sell on Pangolin";
        }

        // 1. جلب تسعيرة الغاز اللحظية بدقة
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("25", 9);
        const gasCostInAvax = gasPrice * ESTIMATED_GAS_UNITS; // تكلفة الغاز بالـ AVAX (18 خانة)

        // 2. جلب سعر صرف AVAX مقابل USDT لحظياً لحساب قيمة الغاز بالدولار
        let wavaxToUsdtRate = ethers.parseUnits("25", 6);
        try {
            const rateAmounts = await traderJoeContract.getAmountsOut(ethers.parseUnits("1.0", 18), pathForward);
            wavaxToUsdtRate = rateAmounts[1];
        } catch (e) {}

        // 3. تحويل تكلفة الغاز من AVAX إلى USDT بدقة رياضية مطلقة
        const gasCostInUsdt = (gasCostInAvax * wavaxToUsdtRate) / ethers.parseUnits("1.0", 18);

        // 4. حساب صافي الربح الحقيقي (الإجمالي ناقص الغاز)
        const netProfit = grossProfit - gasCostInUsdt;

        // عتبة الربح الصافي الأدنى (يجب أن يكون الصافي أكبر من 0.02 USDT لضمان الربحية المطلقة)
        const minNetProfitThreshold = ethers.parseUnits("0.02", 6);

        if (netProfit > minNetProfitThreshold) {
            const alertText =
                `🚀 *Baran Micro-Inefficiency Signal!*\n\n` +
                `📍 *Route:* ${executionRoute}\n` +
                `💰 *Gross Spread:* ${ethers.formatUnits(grossProfit, 6)} USDT\n` +
                `⛽ *Gas Cost:* ${ethers.formatUnits(gasCostInUsdt, 6)} USDT\n` +
                `✨ *Net Profit:* \`${ethers.formatUnits(netProfit, 6)} USDT\`\n` +
                `🌐 *Network:* Avalanche C-Chain`;

            console.log(alertText);
            await sendTelegramAlert(alertText);
        } else {
            console.log(`Scanning... Gross: ${ethers.formatUnits(grossProfit, 6)} USDT | Gas: ${ethers.formatUnits(gasCostInUsdt, 6)} USDT | Net: ${ethers.formatUnits(netProfit, 6)} USDT`);
        }

    } catch (error) {
        console.error("Scanner Loop Error:", error.message);
    }
}

console.log("Baran Micro-Inefficiency Engine Activated. Net profit & dynamic gas calculation enabled.");
setInterval(scanMarketOpportunities, 4000);