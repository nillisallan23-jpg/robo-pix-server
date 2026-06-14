import axios from 'axios';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

dotenv.config();

const supabase = axios.create({
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

const QR_SELECTORS = [
  'img[alt*="QR" i]',
  'img[src^="data:image"]',
  'canvas[class*="qr" i]',
  'canvas',
  '[class*="qrcode" i] img',
  '[data-testid*="qr" i] img'
];
const QR_TIMEOUT_MS = 25000;

type CampoBanco = 'cpf' | 'cnpj' | 'agencia' | 'conta' | 'senha';

interface BancoMapa {
  campos: Partial<Record<CampoBanco, string[]>>;
  submit: string[];
  submitTexto?: string[];
}

const MAPA_BANCOS: Record<string, BancoMapa> = {
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

function resolverMapa(bancoNome: string): BancoMapa {
  const chave = (bancoNome || '').toLowerCase().trim();
  for (const key of Object.keys(MAPA_BANCOS)) {
    if (key !== 'default' && chave.includes(key)) return MAPA_BANCOS[key];
  }
  return MAPA_BANCOS.default;
}

async function acharCampo(page: any, seletores: string[]) {
  for (const sel of seletores) {
    const el = await page.$(sel);
    if (el) return { el, sel };
  }
  return null;
}

async function clicarBotao(page: any, mapa: BancoMapa): Promise<boolean> {
  for (const sel of mapa.submit) {
    const btn = await page.$(sel);
    if (btn) {
      await btn.click();
      return true;
    }
  }
  if (mapa.submitTexto?.length) {
    return await page.evaluate((textos: string[]) => {
      const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
      for (const b of btns) {
        const txt = (b.textContent || (b as HTMLInputElement).value || '').trim().toLowerCase();
        if (textos.some(t => txt.includes(t.toLowerCase()))) {
          (b as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, mapa.submitTexto);
  }
  return false;
}

async function preencherFormulario(page: any, banco: any): Promise<{ ok: boolean; motivo?: string }> {
  const mapa = resolverMapa(banco.banco_nome);
  const dados = { cpf: banco.cpf, cnpj: banco.cnpj, agencia: banco.agencia, conta: banco.conta, senha: banco.senha };

  for (const campo of Object.keys(mapa.campos) as CampoBanco[]) {
    const valor = dados[campo];
    if (!valor || valor.trim() === '') continue; 

    const seletores = mapa.campos[campo] || [];
    const achado = await acharCampo(page, seletores);
    if (achado) {
      await achado.el.click({ clickCount: 3 }).catch(() => {});
      await achado.el.type(String(valor), { delay: 30 });
      console.log(`[FORM] Preenchido "${campo}"`);
    }
  }

  await clicarBotao(page, mapa);
  await new Promise(r => setTimeout(r, 3000)); // Aguarda renderização pós-interação
  return { ok: true };
}

async function capturarQRCode(page: any): Promise<string | null> {
  const deadline = Date.now() + QR_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const selector of QR_SELECTORS) {
      const handle = await page.$(selector);
      if (!handle) continue;
      try {
        const tagName = await handle.evaluate((el: Element) => el.tagName);
        if (tagName === 'IMG') {
          const src = await handle.evaluate((el: HTMLImageElement) => el.src);
          if (src && (src.startsWith('data:image') || src.startsWith('http'))) return src;
        }
        if (tagName === 'CANVAS') {
          const dataUrl = await handle.evaluate((el: HTMLCanvasElement) => el.toDataURL('image/png'));
          if (dataUrl && dataUrl.length > 500) return dataUrl;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

async function atualizarStatus(id: string, status: 'aguardando_leitura' | 'erro', extra: Record<string, any> = {}) {
  try {
    await supabase.patch(`/rest/v1/robo_bancos_config?id=eq.${id}`, { status, ...extra, updated_at: new Date().toISOString() });
  } catch {}
}

export async function executarRobo() {
  if (isExecuting) return;
  isExecuting = true;
  try {
    const { data: todosOsBancos } = await supabase.get('/rest/v1/robo_bancos_config');
    const pendencias = (todosOsBancos || []).filter((b: any) => ['pendente', 'erro'].includes(String(b.status).trim().toLowerCase()));
    
    for (const banco of pendencias) {
      let browser;
      try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.goto(banco.url_login, { waitUntil: 'networkidle2', timeout: 30000 });
        
        await preencherFormulario(page, banco);
        const qrCode = await capturarQRCode(page);
        
        if (qrCode) await atualizarStatus(banco.id, 'aguardando_leitura', { qr_code_url: qrCode });
        else await atualizarStatus(banco.id, 'erro');
      } catch (e) { await atualizarStatus(banco.id, 'erro'); }
      finally { if (browser) await browser.close(); }
    }
  } finally { isExecuting = false; }
}

setInterval(executarRobo, 10000);
executarRobo();