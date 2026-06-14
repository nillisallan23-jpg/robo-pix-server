"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executarRobo = executarRobo;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const puppeteer_1 = __importDefault(require("puppeteer"));
dotenv_1.default.config();
const supabase = axios_1.default.create({
    baseURL: process.env.SUPABASE_URL,
    headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    },
    timeout: 15000
});
let isExecuting = false;
// ---------- QR Code ----------
const QR_SELECTORS = [
    'img[alt*="QR" i]',
    'img[src^="data:image"]',
    'canvas[class*="qr" i]',
    'canvas',
    '[class*="qrcode" i] img',
    '[data-testid*="qr" i] img'
];
const QR_TIMEOUT_MS = 25000;
const MAPA_BANCOS = {
    nubank: {
        campos: {
            cpf: ['input[name="cpf"]', 'input[type="tel"]', 'input[type="text"]', 'input#input-0'],
            senha: ['input[name="password"]', 'input[type="password"]']
        },
        submit: ['button[type="submit"]', 'button[data-testid*="login" i]'],
        submitTexto: ['Acessar', 'Entrar', 'Continuar']
    },
    default: {
        campos: {
            cpf: ['input[name*="cpf" i]', 'input[type="tel"]'],
            cnpj: ['input[name*="cnpj" i]'],
            agencia: ['input[name*="agencia" i]'],
            conta: ['input[name*="conta" i]'],
            senha: ['input[type="password"]']
        },
        submit: ['button[type="submit"]', 'input[type="submit"]'],
        submitTexto: ['Acessar', 'Entrar', 'Continuar', 'Login']
    }
};
function resolverMapa(bancoNome) {
    const chave = (bancoNome || '').toLowerCase().trim();
    for (const key of Object.keys(MAPA_BANCOS)) {
        if (key !== 'default' && chave.includes(key))
            return MAPA_BANCOS[key];
    }
    return MAPA_BANCOS.default;
}
// ---------- Helpers ----------
async function acharCampo(page, seletores) {
    for (const sel of seletores) {
        const el = await page.$(sel);
        if (el)
            return { el, sel };
    }
    return null;
}
async function clicarBotao(page, mapa) {
    for (const sel of mapa.submit) {
        const btn = await page.$(sel);
        if (btn) {
            await btn.click();
            return true;
        }
    }
    return await page.evaluate((textos) => {
        const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
        for (const b of btns) {
            const txt = (b.textContent || b.value || '').trim().toLowerCase();
            if (textos.some(t => txt.includes(t.toLowerCase()))) {
                b.click();
                return true;
            }
        }
        return false;
    }, mapa.submitTexto || []);
}
// ---------- Função Preencher com Diagnóstico ----------
async function preencherFormulario(page, banco) {
    // LOG DE DIAGNÓSTICO
    console.log("DEBUG - Dados recebidos pelo robô:", JSON.stringify(banco, null, 2));
    const mapa = resolverMapa(banco.banco_nome);
    const dados = {
        cpf: banco.cpf,
        cnpj: banco.cnpj,
        agencia: banco.agencia,
        conta: banco.conta,
        senha: banco.senha
    };
    for (const campo of Object.keys(mapa.campos)) {
        const valor = dados[campo];
        if (!valor || valor.trim() === '')
            continue;
        const seletores = mapa.campos[campo] || [];
        const achado = await acharCampo(page, seletores);
        if (achado) {
            await achado.el.click({ clickCount: 3 }).catch(() => { });
            await achado.el.type(String(valor), { delay: 30 });
            console.log(`[FORM] Preenchido "${campo}" com sucesso.`);
        }
        else {
            console.warn(`[FORM] Campo "${campo}" não encontrado no HTML.`);
        }
    }
    await clicarBotao(page, mapa);
    await new Promise(r => setTimeout(r, 3000));
    return { ok: true };
}
async function capturarQRCode(page) {
    const deadline = Date.now() + QR_TIMEOUT_MS;
    while (Date.now() < deadline) {
        for (const selector of QR_SELECTORS) {
            const handle = await page.$(selector);
            if (handle) {
                const tagName = await handle.evaluate((el) => el.tagName);
                if (tagName === 'IMG')
                    return await handle.evaluate((el) => el.src);
                if (tagName === 'CANVAS')
                    return await handle.evaluate((el) => el.toDataURL('image/png'));
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}
async function atualizarStatus(id, status, extra = {}) {
    try {
        await supabase.patch(`/rest/v1/robo_bancos_config?id=eq.${id}`, { status, ...extra, updated_at: new Date().toISOString() });
    }
    catch { }
}
async function executarRobo() {
    if (isExecuting)
        return;
    isExecuting = true;
    try {
        const { data: todosOsBancos } = await supabase.get('/rest/v1/robo_bancos_config');
        const pendencias = (todosOsBancos || []).filter((b) => ['pendente', 'erro'].includes(String(b.status || '').trim().toLowerCase()));
        for (const banco of pendencias) {
            let browser;
            try {
                browser = await puppeteer_1.default.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                const page = await browser.newPage();
                await page.goto(banco.url_login, { waitUntil: 'networkidle2', timeout: 30000 });
                await preencherFormulario(page, banco);
                const qrCode = await capturarQRCode(page);
                if (qrCode)
                    await atualizarStatus(banco.id, 'aguardando_leitura', { qr_code_url: qrCode });
                else
                    await atualizarStatus(banco.id, 'erro');
            }
            catch (e) {
                await atualizarStatus(banco.id, 'erro');
            }
            finally {
                if (browser)
                    await browser.close();
            }
        }
    }
    finally {
        isExecuting = false;
    }
}
setInterval(executarRobo, 10000);
executarRobo();
