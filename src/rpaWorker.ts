import puppeteer from 'puppeteer';
import axios from 'axios';
import dotenv from 'dotenv';
import QRCode from 'qrcode';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
let isExecuting = false;

async function registrarLog(level: 'INFO' | 'SUCESSO' | 'ERRO', message: string) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[RPA] [${timestamp}] [${level}] ${message}`);
  try {
    await axios.post(`${SUPABASE_URL}/rest/v1/robo_logs`, { level, message: `[${timestamp}] ${message}`, contexto: {} }, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
    });
  } catch (error: any) { console.error(`[RPA ERR] Erro no log:`, error.message); }
}

async function atualizarStatusBanco(id: string, novoStatus: string, qrCodeUrl: string | null = null) {
  const body: any = { status: novoStatus };
  if (qrCodeUrl) body.qr_code_url = qrCodeUrl;
  
  await axios.patch(`${SUPABASE_URL}/rest/v1/robo_bancos_config?id=eq.${id}`, body, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }
  });
}

async function buscarBancosPendentes() {
  try {
    const { data } = await axios.get(`${SUPABASE_URL}/rest/v1/robo_bancos_config?status=eq.pendente`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    return data;
  } catch (error: any) {
    await registrarLog('ERRO', `Falha ao buscar pendências: ${error.message}`);
    return [];
  }
}

export async function executarRobo() {
  if (isExecuting) return;
  isExecuting = true;
  
  const pendencias = await buscarBancosPendentes();
  
  for (const banco of pendencias) {
    await registrarLog('INFO', `Iniciando autorização automática para: ${banco.nome_banco}`);
    await atualizarStatusBanco(banco.id, 'processando');
    
    let browser;
    try {
      browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
      });
      
      const page = await browser.newPage();
      
      // LOGICA DE NAVEGAÇÃO (Adicione aqui o seu page.goto())
      // await page.goto(banco.url_login); 

      // BUSCA DINÂMICA: O robô procura pelo elemento que contém as palavras de autorização
      const linkAutenticacao = await page.evaluate(() => {
        const palavrasChave = ['Autorizar', 'Conectar', 'Confirmar', 'QR Code', 'Acesso'];
        const elementos = Array.from(document.querySelectorAll('a, button, div, img'));
        
        const elementoAlvo = elementos.find(el => 
          palavrasChave.some(texto => el.textContent?.includes(texto) || (el as HTMLImageElement).alt?.includes(texto))
        );

        return (elementoAlvo as HTMLAnchorElement)?.href || (elementoAlvo as HTMLImageElement)?.src;
      });

      if (!linkAutenticacao) throw new Error("Não foi possível encontrar o botão de autorização/QR Code na página.");
      
      // Gera o QR Code em Base64
      const qrCodeBase64 = await QRCode.toDataURL(linkAutenticacao);
      
      await registrarLog('SUCESSO', `QR Code gerado automaticamente para ${banco.nome_banco}.`);
      await atualizarStatusBanco(banco.id, 'aguardando_leitura', qrCodeBase64);
      
    } catch (error: any) {
      await registrarLog('ERRO', `Falha em ${banco.nome_banco}: ${error.message}`);
      await atualizarStatusBanco(banco.id, 'erro');
    } finally {
      if (browser) await browser.close();
    }
  }
  isExecuting = false;
}

if (require.main === module) {
  setInterval(executarRobo, 5000);
  executarRobo();
}