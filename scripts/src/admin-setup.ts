// scripts/src/admin-setup.ts
// ===========================================================================
// POST-DEPLOY PROTOCOL CONFIGURATION — NOT deployment, NOT an e2e flow test.
//
// Assumes the maintainer ALREADY ran `sui client publish` for the 3 Sweem
// packages and filled deployed.json. This one-shot configures the shared
// ProtocolRegistry / ProtocolConfig via registry::{add_protocol, set_fees,
// set_treasury}, gated by the AccessControl<REGISTRY> object (the signer must
// hold ProtocolManagerRole + FeeManagerRole — granted to the publisher in
// registry::init). The maintainer may run this OR configure the registry by
// hand; it is offered as a convenience, never as a deploy step.
//
// Dry run by default (prints the tx). Add --execute (or EXECUTE=1) to submit.
// ===========================================================================

import { Transaction } from '@mysten/sui/transactions'

import {
  DEPOSIT_FEE_BPS,
  ORG_YIELD_FEE_BPS,
  VAULT_YIELD_FEE_BPS,
  TREASURY_ENV,
  loadDeployed,
} from './config.ts'
import { buildAndMaybeRun, log, ok, requireId, signerAddress } from './lib.ts'

async function main() {
  const d = loadDeployed()
  const treasury = TREASURY_ENV ?? signerAddress()

  const registryPkg = requireId(d.sweemRegistryPkg, 'sweemRegistryPkg')
  const adaptersPkg = requireId(d.sweemAdaptersPkg, 'sweemAdaptersPkg')
  const ac = requireId(d.accessControl, 'accessControl')
  const registry = requireId(d.protocolRegistry, 'protocolRegistry')
  const config = requireId(d.protocolConfig, 'protocolConfig')

  log(`admin-setup as ${signerAddress()} (must hold registry roles)`)
  log(`treasury=${treasury} fees: deposit=${DEPOSIT_FEE_BPS} org=${ORG_YIELD_FEE_BPS} vault=${VAULT_YIELD_FEE_BPS}`)

  const tx = new Transaction()

  // add_protocol(registry, ac, name: String, adapter_package: address, yield_type: u8, ctx)
  // yield_type 0 = L (lending) for both navi and scallop.
  for (const name of ['navi', 'scallop']) {
    tx.moveCall({
      target: `${registryPkg}::registry::add_protocol`,
      arguments: [
        tx.object(registry),
        tx.object(ac),
        tx.pure.string(name),
        tx.pure.address(adaptersPkg),
        tx.pure.u8(0),
      ],
    })
  }

  // set_fees(config, ac, deposit_fee_bps, org_yield_fee_bps, vault_yield_fee_bps, ctx)
  tx.moveCall({
    target: `${registryPkg}::registry::set_fees`,
    arguments: [
      tx.object(config),
      tx.object(ac),
      tx.pure.u64(DEPOSIT_FEE_BPS),
      tx.pure.u64(ORG_YIELD_FEE_BPS),
      tx.pure.u64(VAULT_YIELD_FEE_BPS),
    ],
  })

  // set_treasury(config, ac, treasury, ctx)
  tx.moveCall({
    target: `${registryPkg}::registry::set_treasury`,
    arguments: [tx.object(config), tx.object(ac), tx.pure.address(treasury)],
  })

  const res = await buildAndMaybeRun(tx, 'admin-setup (add_protocol x2 + set_fees + set_treasury)')
  if (res.executed) ok('protocols registered, fees + treasury configured.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
