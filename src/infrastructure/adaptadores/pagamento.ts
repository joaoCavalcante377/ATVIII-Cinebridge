import { ErroIntegracao, validarPagamento } from '../../application/adaptadores.ts';
import type { AdaptadorPagamento, StatusPagamento } from '../../application/adaptadores.ts';
import { FalhaExterna } from '../sistemas-externos.ts';
import type { GatewayPagamento, ProvedorPagamento } from '../sistemas-externos.ts';

/** Etapas comuns; cada subclasse traduz unidade, campos e status do seu gateway. */
abstract class AdaptadorGateway implements AdaptadorPagamento {
  abstract readonly provedor: ProvedorPagamento;
  protected readonly gateway: GatewayPagamento;
  constructor(gateway: GatewayPagamento) { this.gateway = gateway; }
  protected abstract valor(centavos: number): number;
  protected abstract dados(origem: string, destino: string, referencia?: string): Record<string, unknown>;
  protected abstract readonly status: Record<string, StatusPagamento>;

  protected verificarProvedor(): void {
    if (this.gateway.provedor !== this.provedor) throw new ErroIntegracao(`Adaptador ${this.provedor} recebeu o gateway ${this.gateway.provedor}.`, 500);
  }
  private falha(erro: unknown): never {
    if (erro instanceof FalhaExterna) {
      if (erro.codigo === '404') throw new ErroIntegracao('Pagamento não encontrado no provedor.', 404);
      if (erro.codigo === '503') throw new ErroIntegracao(`Gateway ${this.provedor} indisponível.`, 503);
      throw new ErroIntegracao(`O gateway ${this.provedor} recusou a requisição: ${erro.message}.`);
    }
    throw erro;
  }
  async efetuarPagamento(valor: number, origem: string, destino: string, referencia?: string): Promise<string> {
    this.verificarProvedor();
    validarPagamento(valor, origem, destino);
    try { return (await this.gateway.processarPagamento(this.valor(valor), this.dados(origem, destino, referencia))).id; }
    catch (erro) { return this.falha(erro); }
  }
  async cancelarPagamento(id: string): Promise<boolean> {
    this.verificarProvedor();
    try { return await this.gateway.estornarPagamento(id); } catch (erro) { return this.falha(erro); }
  }
  async verificarPagamento(id: string): Promise<StatusPagamento> {
    this.verificarProvedor();
    let status: string;
    try { status = await this.gateway.consultarStatus(id); } catch (erro) { return this.falha(erro); }
    const traduzido = this.status[status];
    if (!traduzido) throw new ErroIntegracao(`Status desconhecido do gateway ${this.provedor}: ${status}.`);
    return traduzido;
  }
}

/** Stripe trabalha em centavos inteiros e usa chave de idempotência. */
export class AdaptadorStripe extends AdaptadorGateway {
  readonly provedor = 'stripe';
  protected readonly status: Record<string, StatusPagamento> = { succeeded: 'APROVADO', processing: 'PENDENTE', requires_payment_method: 'RECUSADO', canceled: 'CANCELADO' };
  protected valor(centavos: number): number { return centavos; }
  protected dados(origem: string, destino: string, referencia?: string) {
    return { customer: origem, destination: destino, currency: 'brl', ...(referencia ? { idempotency_key: referencia } : {}) };
  }
}

/** PagSeguro recebe reais com duas casas e identifica o pedido por reference_id. */
export class AdaptadorPagSeguro extends AdaptadorGateway {
  readonly provedor = 'pagseguro';
  protected readonly status: Record<string, StatusPagamento> = { PAID: 'APROVADO', WAITING: 'PENDENTE', DECLINED: 'RECUSADO', CANCELED: 'CANCELADO' };
  protected valor(centavos: number): number { return centavos / 100; }
  protected dados(origem: string, destino: string, referencia?: string) {
    return { pagador: origem, recebedor: destino, ...(referencia ? { reference_id: referencia } : {}) };
  }
}

/** PayPal recebe reais, identifica pagador/recebedor por conta e a fatura por invoice_id. */
export class AdaptadorPayPal extends AdaptadorGateway {
  readonly provedor = 'paypal';
  protected readonly status: Record<string, StatusPagamento> = { COMPLETED: 'APROVADO', PENDING: 'PENDENTE', DENIED: 'RECUSADO', REFUNDED: 'CANCELADO' };
  protected valor(centavos: number): number { return centavos / 100; }
  protected dados(origem: string, destino: string, referencia?: string) {
    return { payer_id: origem, payee_email: destino, intent: 'CAPTURE', ...(referencia ? { invoice_id: referencia } : {}) };
  }
}
