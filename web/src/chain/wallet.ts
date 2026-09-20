// wallet.ts — wallet injected (MetaMask) di Arbitrum Sepolia: connect, pastikan chain, simulate → write → tunggu receipt, dekode revert.
import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, getAddress, type Address, type Hash } from 'viem';
import { chain, client } from './client';
import { REVERT_TEXT, type TradeCall } from './trade';

export function hasWallet(): boolean { return typeof window !== 'undefined' && !!window.ethereum; }
export function walletClient() {
  if (!hasWallet()) throw new Error('No injected wallet (MetaMask) found');
  return createWalletClient({ chain, transport: custom(window.ethereum as never) });
}
export async function connect(): Promise<Address> {
  const [a] = await walletClient().requestAddresses();
  if (!a) throw new Error('No account');
  await ensureChain();
  return a;
}
/** Pindah ke Arbitrum Sepolia; bila wallet belum mengenal chain-nya, tambahkan (wallet_addEthereumChain) lalu pindah. */
export async function ensureChain(): Promise<void> {
  const w = walletClient();
  const id = await w.getChainId();
  if (id === chain.id) return;
  try { await w.switchChain({ id: chain.id }); } catch { await w.addChain({ chain }); await w.switchChain({ id: chain.id }); }
}
/** Nama custom error dari ABI → pesan manusiawi (REVERT_TEXT); selain itu shortMessage viem (mis. "User rejected the request."). */
export function decodeRevert(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r) {
      const name = r.data?.errorName;
      if (name) return REVERT_TEXT[name] ?? `Reverted: ${name}`;
      if (r.reason) return `Reverted: ${r.reason}`;
      if (r.signature) return `Reverted: ${r.signature}`;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
/** simulate (eth_call lewat RPC publik, revert didekode sebelum popup wallet) → write lewat wallet → tunggu receipt; mengembalikan hash. */
export async function write(call: TradeCall, account: Address): Promise<Hash> {
  await ensureChain();
  const { request } = await client.simulateContract({ ...call, account });
  const hash = await walletClient().writeContract(request);
  const rc = await client.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`Transaction ${hash} failed (status 0)`);
  return hash;
}
/** Pendengar EIP-1193: MetaMask memancarkan `accountsChanged([])` saat disconnect dan `chainChanged(hexId)` saat jaringan berganti. */
export function onWalletEvents(h: { accounts(a: Address[]): void; chain(id: number): void }): void {
  const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
  if (!eth?.on) return;
  eth.on('accountsChanged', (a) => h.accounts(((a as string[]) ?? []).map((x) => getAddress(x))));
  eth.on('chainChanged', (id) => h.chain(Number(id)));
}
