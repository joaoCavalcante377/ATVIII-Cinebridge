import type { AdaptadorArmazenamento, AdaptadorPagamento } from '../../application/adaptadores.ts';
import { ArmazenamentoExterno, GatewayPagamento } from '../sistemas-externos.ts';
import { AdaptadorGoogleCloud, AdaptadorLocal, AdaptadorS3 } from './armazenamento.ts';
import { AdaptadorPagSeguro, AdaptadorPayPal, AdaptadorStripe } from './pagamento.ts';

export * from './armazenamento.ts';
export * from './pagamento.ts';
export * from './profissionais.ts';

type Ambiente = Record<string, string | undefined>;

/** Escolhe o provedor de armazenamento pela configuração. O padrão grava em disco local. */
export function armazenamentoDoAmbiente(env: Ambiente = process.env): AdaptadorArmazenamento {
  const provedor = env.ARMAZENAMENTO ?? 'local';
  switch (provedor) {
    case 'local': return new AdaptadorLocal(env.ARMAZENAMENTO_DIR ?? '.local/arquivos');
    case 's3': return new AdaptadorS3(new ArmazenamentoExterno('s3', env.ARMAZENAMENTO_BUCKET ?? 'cinebridge-midias'));
    case 'gcs': return new AdaptadorGoogleCloud(new ArmazenamentoExterno('gcs', env.ARMAZENAMENTO_BUCKET ?? 'cinebridge-midias'));
    default: throw new Error(`ARMAZENAMENTO inválido: ${provedor}. Use local, s3 ou gcs.`);
  }
}

/** Escolhe o gateway de pagamento simulado pela configuração. */
export function pagamentoDoAmbiente(env: Ambiente = process.env): AdaptadorPagamento {
  const provedor = env.PAGAMENTO ?? 'stripe';
  switch (provedor) {
    case 'stripe': return new AdaptadorStripe(new GatewayPagamento('stripe'));
    case 'pagseguro': return new AdaptadorPagSeguro(new GatewayPagamento('pagseguro'));
    case 'paypal': return new AdaptadorPayPal(new GatewayPagamento('paypal'));
    default: throw new Error(`PAGAMENTO inválido: ${provedor}. Use stripe, pagseguro ou paypal.`);
  }
}
