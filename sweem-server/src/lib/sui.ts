import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

export type SuiClient = SuiJsonRpcClient

export function createSuiClient(network: string): SuiJsonRpcClient {
  const net = network === 'mainnet' ? 'mainnet' : 'testnet'
  return new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(net),
    network: net,
  })
}

export async function getObjectFields(
  client: SuiJsonRpcClient,
  objectId: string,
): Promise<Record<string, unknown> | null> {
  const obj = await client.getObject({ id: objectId, options: { showContent: true } })
  if (obj.data?.content?.dataType !== 'moveObject') return null
  return obj.data.content.fields as Record<string, unknown>
}
