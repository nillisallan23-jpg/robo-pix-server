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

// Seletores comuns de QR Code. Ajuste/adicione conforme o banco.
const QR_SELECTORS = [
  'img[alt*="QR" i]',
  'img[src^="data:image"]',
  'canvas[class*="qr" i]',
  'canvas',
  '[class*="qrcode" i] img',
  '[data-testid*="qr" i] img'
];
const QR_TIMEOUT_MS = 25000;

async function atualizarStatus(
  id: string,
  status: 'aguardando_leitura' | 'erro',
  extra: Record<string, any> = {}
) {
  try {
    await supabase.patch(
      `/rest/v1/robo_bancos_config?id=eq.${id}`,
      { status, ...extra, updated_at: new Date().toISOString() }
    );
    console.log(`[LOG] Status do banco ${id} atualizado para: ${status}`);
  } catch (e: any) {
    console.error(`[ERRO] Falha ao atualizar status do banco ${id}:`, e.message);
  }
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
          if (src && (src.startsWith('data:image') || src.startsWith('http'))) {
            console.log(`[QR] Capturado via <img> (${selector})`);
            return src;
          }
        }

        if (tagName === 'CANVAS') {
          const dataUrl = await handle.evaluate(
            (el: HTMLCanvasElement) => el.toDataURL('image/png')
          );
          // canvas vazio resulta num data:URL muito curto
          if (dataUrl && dataUrl.length > 500) {
            console.log(`[QR] Capturado via <canvas> (${selector})`);
            return dataUrl;
          }
        }
      } catch {
        // segue tentando outros seletores
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export async function executarRobo() {
  if (isExecuting) return;
  isExecuting = true;

  try {
    const { data: todosOsBancos } = await supabase.get('/rest/v1/robo_bancos_config');
    const pendencias = (todosOsBancos || []).filter((b: any) =>
      ['pendente', 'erro'].includes(String(b.status).trim().toLowerCase())
    );

    console.log(`[LOG] Bancos encontrados para processar: ${pendencias.length}`);

    for (const banco of pendencias) {
      console.log(`[DEBUG] Processando Banco ID: ${banco.id} | Status: ${banco.status}`);

      if (!banco.url_login) {
        console.warn(`[WARN] Banco ${banco.id} sem url_login. Marcando como erro.`);
        await atualizarStatus(banco.id, 'erro');
        continue;
      }

      let browser;
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`[NAV] Navegando para: ${banco.url_login}`);
        await page.goto(banco.url_login, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        console.log(`[OK] Página carregada para banco ${banco.id}. Aguardando QR Code...`);
        const qrCode = await capturarQRCode(page);

        if (qrCode) {
          await atualizarStatus(banco.id, 'aguardando_leitura', { qr_code_url: qrCode });
        } else {
          console.error(`[ERRO] QR Code não encontrado para banco ${banco.id} (timeout).`);
          await atualizarStatus(banco.id, 'erro');
        }
      } catch (navErr: any) {
        console.error(`[ERRO] Falha na navegação do banco ${banco.id}:`, navErr.message);
        await atualizarStatus(banco.id, 'erro');
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch (closeErr: any) {
            console.error(`[ERRO] Falha ao fechar browser do banco ${banco.id}:`, closeErr.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[ERRO] Falha no ciclo:', err.message);
  } finally {
    isExecuting = false;
  }
}

setInterval(executarRobo, 10000);
executarRobo();
