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
            cpf: ['input[name="cpf"]', 'input[type="tel"]', 'input[type="text"]'],
            senha: ['input[name="password"]', 'input[type="password"]']
        },
        submit: ['button[type="submit"]', 'button[data-testid*="login" i]'],
        submitTexto: ['Acessar', 'Entrar', 'Continuar']
    },
    itau: {
        campos: {
            agencia: ['input[name*="agencia" i]', 'input[id*="agencia" i]'],
            conta: ['input[name*="conta" i]', 'input[id*="conta" i]']
        },
        submit: ['button[type="submit"]'],
        submitTexto: ['Acessar', 'Entrar', 'Continuar']
    },
    bradesco: {
        campos: {
            agencia: ['input[name*="agencia" i]'],
            conta: ['input[name*="conta" i]'],
            cpf: ['input[name*="cpf" i]']
        },
        submit: ['button[type="submit"]'],
        submitTexto: ['Acessar', 'Entrar']
    },
    // fallback genérico
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
            console.log(`[FORM] Clicando botão via seletor: ${sel}`);
            await btn.click();
            return true;
        }
    }
    if (mapa.submitTexto?.length) {
        const clicado = await page.evaluate((textos) => {
            const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
            for (const b of btns) {
                const txt = (b.textContent || b.value || '').trim().toLowerCase();
                if (textos.some(t => txt.includes(t.toLowerCase()))) {
                    b.click();
                    return true;
                }
            }
            return false;
        }, mapa.submitTexto);
        if (clicado) {
            console.log(`[FORM] Clicado por texto: ${mapa.submitTexto.join('|')}`);
            return true;
        }
    }
    return false;
}
async function preencherFormulario(page, banco) {
    const mapa = resolverMapa(banco.banco_nome);
    const dados = {
        cpf: banco.cpf,
        cnpj: banco.cnpj,
        agencia: banco.agencia,
        conta: banco.conta,
        senha: banco.senha
    };
    let preenchidos = 0;
    for (const campo of Object.keys(mapa.campos)) {
        const valor = dados[campo];
        if (!valor) {
            console.log(`[FORM] Campo "${campo}" não cadastrado no Supabase — pulando.`);
            continue;
        }
        const seletores = mapa.campos[campo] || [];
        const achado = await acharCampo(page, seletores);
        if (!achado) {
            console.warn(`[FORM] Campo "${campo}" não encontrado na página (seletores: ${seletores.join(', ')}).`);
            continue;
        }
        await achado.el.click({ clickCount: 3 }).catch(() => { });
        await achado.el.type(String(valor), { delay: 30 });
        console.log(`[FORM] Preenchido "${campo}" em ${achado.sel}`);
        preenchidos++;
    }
    if (preenchidos === 0) {
        return { ok: false, motivo: 'Nenhum campo preenchido (dados ausentes ou seletores incompatíveis).' };
    }
    const clicou = await clicarBotao(page, mapa);
    if (!clicou)
        return { ok: false, motivo: 'Botão de acesso não encontrado.' };
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {
        console.log('[FORM] Sem navegação após clique — seguindo para captura do QR.');
    });
    return { ok: true };
}
async function capturarQRCode(page) {
    const deadline = Date.now() + QR_TIMEOUT_MS;
    while (Date.now() < deadline) {
        for (const selector of QR_SELECTORS) {
            const handle = await page.$(selector);
            if (!handle)
                continue;
            try {
                const tagName = await handle.evaluate((el) => el.tagName);
                if (tagName === 'IMG') {
                    const src = await handle.evaluate((el) => el.src);
                    if (src && (src.startsWith('data:image') || src.startsWith('http')))
                        return src;
                }
                if (tagName === 'CANVAS') {
                    const dataUrl = await handle.evaluate((el) => el.toDataURL('image/png'));
                    if (dataUrl && dataUrl.length > 500)
                        return dataUrl;
                }
            }
            catch { }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}
async function atualizarStatus(id, status, extra = {}) {
    try {
        await supabase.patch(`/rest/v1/robo_bancos_config?id=eq.${id}`, { status, ...extra, updated_at: new Date().toISOString() });
        console.log(`[LOG] Status do banco ${id} -> ${status}`);
    }
    catch (e) {
        console.error(`[ERRO] Falha ao atualizar status do banco ${id}:`, e.message);
    }
}
// ---------- Loop principal ----------
async function executarRobo() {
    if (isExecuting)
        return;
    isExecuting = true;
    try {
        const { data: todosOsBancos } = await supabase.get('/rest/v1/robo_bancos_config');
        const pendencias = (todosOsBancos || []).filter((b) => ['pendente', 'erro'].includes(String(b.status).trim().toLowerCase()));
        console.log(`[LOG] Bancos para processar: ${pendencias.length}`);
        for (const banco of pendencias) {
            console.log(`[DEBUG] Banco ${banco.id} (${banco.banco_nome}) status=${banco.status}`);
            if (!banco.url_login) {
                await atualizarStatus(banco.id, 'erro');
                continue;
            }
            let browser;
            try {
                browser = await puppeteer_1.default.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const page = await browser.newPage();
                await page.setViewport({ width: 1280, height: 800 });
                console.log(`[NAV] ${banco.url_login}`);
                await page.goto(banco.url_login, { waitUntil: 'networkidle2', timeout: 30000 });
                const form = await preencherFormulario(page, banco);
                if (!form.ok) {
                    console.error(`[ERRO] Formulário do banco ${banco.id}: ${form.motivo}`);
                    console.log('URL:', page.url(), '| Título:', await page.title());
                    await atualizarStatus(banco.id, 'erro');
                    continue;
                }
                const qrCode = await capturarQRCode(page);
                if (qrCode) {
                    await atualizarStatus(banco.id, 'aguardando_leitura', { qr_code_url: qrCode });
                }
                else {
                    console.error(`[ERRO] QR não encontrado para banco ${banco.id}`);
                    console.log('URL:', page.url(), '| Título:', await page.title());
                    console.log('Frames:', page.frames().map((f) => f.url()));
                    await atualizarStatus(banco.id, 'erro');
                }
            }
            catch (navErr) {
                console.error(`[ERRO] Navegação banco ${banco.id}:`, navErr.message);
                await atualizarStatus(banco.id, 'erro');
            }
            finally {
                if (browser) {
                    try {
                        await browser.close();
                    }
                    catch { }
                }
            }
        }
    }
    catch (err) {
        console.error('[ERRO] Ciclo:', err.message);
    }
    finally {
        isExecuting = false;
    }
}
setInterval(executarRobo, 10000);
executarRobo();
