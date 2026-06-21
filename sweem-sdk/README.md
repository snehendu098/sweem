# @sweem/sdk

A drop in crypto checkout component for React. Accept USDC and SUI payments on the Sui network with a single component. Sweem handles wallet connection, the on chain transfer, and the confirmation experience, so you can collect payments without writing any blockchain code.

## Overview

The package exposes a `SweemPayButton` component. When a customer clicks it, a checkout modal opens, the customer connects a Sui wallet, selects a token, and pays your receiving address. Your application is notified with the transaction digest once the payment is confirmed.

The component bundles its own wallet and data fetching providers, so the host application does not need any prior Sui or dapp-kit setup.

## Installation

```bash
npm install @sweem/sdk
```

`react` and `react-dom` (version 18 or later) are peer dependencies and are expected to be present in the host project.

## Getting an API key

1. Sign in to the Sweem dashboard.
2. Open Developer, then API keys.
3. Generate a publishable key. It has the form `pk_live_...` and maps to your organization's receiving wallet.

Publishable keys are safe to ship in client side code. Store the key in an environment variable.

```bash
NEXT_PUBLIC_SWEEM_API_KEY=pk_live_xxxxxxxxxxxxxxxx
```

## Quick start

```tsx
import { SweemPayButton } from "@sweem/sdk";

export function Checkout() {
  return (
    <SweemPayButton
      apiKey={process.env.NEXT_PUBLIC_SWEEM_API_KEY!}
      amount={49.99}
      onSuccess={(result) => console.log("Paid. Transaction:", result.digest)}
    >
      Pay 49.99
    </SweemPayButton>
  );
}
```

## Props

| Prop | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `apiKey` | `string` | Yes | Your publishable key. |
| `amount` | `number` | Yes | The amount to charge, expressed in whole token units. |
| `token` | `"USDC" \| "SUI"` | No | Lock the payment to a single token. Omit to let the customer choose. |
| `network` | `"mainnet" \| "testnet" \| "devnet"` | No | The Sui network to use. Defaults to `mainnet`. |
| `onSuccess` | `(result: PaymentResult) => void` | No | Called with the transaction digest after a confirmed payment. |
| `onError` | `(error: Error) => void` | No | Called when a payment fails. |
| `render` | `(open: () => void) => ReactNode` | No | Render a custom trigger instead of the default button. |

`PaymentResult` contains `digest`, `amount`, `token`, and `recipient`.

## Choosing a token

Pass the `token` prop to charge a specific asset and hide the token selector.

```tsx
<SweemPayButton apiKey={KEY} amount={10} token="USDC" />
```

## Custom trigger

Use the `render` prop to connect the checkout flow to your own button or menu item.

```tsx
<SweemPayButton
  apiKey={KEY}
  amount={10}
  render={(open) => <button onClick={open}>Checkout</button>}
/>
```

## Using an existing dapp-kit setup

If your application already wraps the `@mysten/dapp-kit` providers, render the modal directly and reuse the existing wallet context instead of the bundled provider.

```tsx
import { PayModal } from "@sweem/sdk";

<PayModal open={open} onClose={close} apiKey={KEY} amount={20} />;
```

## Local development

To test the flow before configuring a key, pass `recipient` (and optionally `merchant`) to bypass the backend lookup.

```tsx
<SweemPayButton
  apiKey="pk_test"
  amount={1}
  recipient="0xYOUR_RECEIVING_ADDRESS"
  merchant="Acme"
/>
```

## How payments settle

The customer's wallet transfers the selected token to the receiving address associated with your API key. Settlement happens directly on the Sui network. The `onSuccess` callback returns the transaction digest, which can be viewed on Suiscan at `https://suiscan.xyz/mainnet/tx/<digest>`.

## TypeScript

The package ships with type definitions. The exported types include `PaymentResult`, `CheckoutConfig`, `TokenConfig`, `TokenSymbol`, and `SweemNetwork`.

## License

MIT
