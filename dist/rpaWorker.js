"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executarRobo = executarRobo;
const puppeteer_1 = __importDefault(require("puppeteer"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const qrcode_1 = __importDefault(require("qrcode"));
dotenv_1.default.config();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
let isExecuting = false;
async function registrarLog(level, message) {
    const timestamp = new Date().toLocaleTimeString();
    const msgFormatada = `[${timestamp}] ${message}`;
    console.log(`[RPA] [${level}] ${msgFormatada}`);
    try {
        await axios_1.default.post(`${SUPABASE_URL}/rest/v1/robo_logs`, { level, message: msgFormatada, contexto: {} }, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            }
        });
    }
    catch (error) {
        if (error.response) {
            console.error(`[RPA ERR] Resposta do Supabase:`, JSON.stringify(error.response.data));
        }
        else {
            console.error(`[RPA ERR] Erro de conexão:`, error.message);
        }
    }
}
async function atualizarStatusBanco(id, novoStatus, qrCodeUrl = null) {
    const body = { status: novoStatus };
    if (qrCodeUrl)
        body.qr_code_url = qrCodeUrl;
    await axios_1.default.patch(`${SUPABASE_URL}/rest/v1/robo_bancos_config?id=eq.${id}`, body, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }
    });
}
async function buscarBancosPendentes() {
    try {
        const { data } = await axios_1.default.get(`${SUPABASE_URL}/rest/v1/robo_bancos_config?status=eq.pendente`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        return data;
    }
    catch (error) {
        await registrarLog('ERRO', `Falha ao buscar pendências: ${error.message}`);
        return [];
    }
}
async function executarRobo() {
    if (isExecuting)
        return;
    isExecuting = true;
    const pendencias = await buscarBancosPendentes();
    for (const banco of pendencias) {
        await registrarLog('INFO', `Iniciando autorização automática para: ${banco.nome_banco}`);
        await atualizarStatusBanco(banco.id, 'processando');
        let browser;
        try {
            browser = await puppeteer_1.default.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-zygote', // CRÍTICO para Docker
                    '--single-process' // Reduz memória
                ]
            });
            const page = await browser.newPage();
            // Timeouts de segurança para não travar o robô
            await page.setDefaultNavigationTimeout(30000);
            await page.setDefaultTimeout(30000);
            await page.goto(banco.url_login, { waitUntil: 'networkidle2' });
            const linkAutenticacao = await page.evaluate(() => {
                const palavrasChave = ['Autorizar', 'Conectar', 'Confirmar', 'QR Code', 'Acesso'];
                const elementos = Array.from(document.querySelectorAll('a, button, div, img'));
                const elementoAlvo = elementos.find(el => palavrasChave.some(texto => el.textContent?.includes(texto) || el.alt?.includes(texto)));
                return elementoAlvo?.href || elementoAlvo?.src;
            });
            if (!linkAutenticacao)
                throw new Error("Não foi possível encontrar o botão de autorização/QR Code na página.");
            const qrCodeBase64 = await qrcode_1.default.toDataURL(linkAutenticacao);
            await registrarLog('SUCESSO', `QR Code gerado automaticamente para ${banco.nome_banco}.`);
            await atualizarStatusBanco(banco.id, 'aguardando_leitura', qrCodeBase64);
        }
        catch (error) {
            await registrarLog('ERRO', `Falha em ${banco.nome_banco}: ${error.message}`);
            await atualizarStatusBanco(banco.id, 'erro');
        }
        finally {
            if (browser)
                await browser.close();
        }
    }
    isExecuting = false;
}
// Inicialização
console.log("[RPA] Serviço inicializado com sucesso. Iniciando loops...");
// Heartbeat local
setInterval(() => {
    console.log(`[HEARTBEAT] [${new Date().toLocaleTimeString()}] Worker ativo. Executando? ${isExecuting}`);
}, 60000);
// Loop principal
setInterval(async () => {
    try {
        await executarRobo();
    }
    catch (err) {
        console.error("[CRITICAL ERR] Erro não tratado no setInterval:", err);
    }
}, 5000);
executarRobo();
