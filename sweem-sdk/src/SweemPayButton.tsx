import { useState, type CSSProperties, type ReactNode } from "react";
import { SweemProvider } from "./SweemProvider";
import { PayModal, type PayModalProps } from "./PayModal";
import { theme } from "./theme";
import type { SweemNetwork } from "./types";

export interface SweemPayButtonProps
  extends Omit<PayModalProps, "open" | "onClose"> {
  /** Button label. Defaults to "Pay with Sweem". */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Sui network to connect to. Defaults to mainnet. */
  network?: SweemNetwork;
  /** Render your own trigger instead of the default button. */
  render?: (open: () => void) => ReactNode;
}

// One-line integration: drop this in, pass your publishable key + amount, done.
// Bundles its own wallet + query providers so the host app needs no Sui setup.
export function SweemPayButton({ children, className, style, network = "mainnet", render, ...modalProps }: SweemPayButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <SweemProvider network={network}>
      {render ? (
        render(() => setOpen(true))
      ) : (
        <button
          type="button"
          className={className}
          onClick={() => setOpen(true)}
          style={
            className
              ? style
              : {
                  borderRadius: 9999,
                  border: "none",
                  background: theme.mint,
                  color: "#000",
                  padding: "12px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: theme.font,
                  ...style,
                }
          }
        >
          {children ?? "Pay with Sweem"}
        </button>
      )}
      <PayModal {...modalProps} open={open} onClose={() => setOpen(false)} />
    </SweemProvider>
  );
}
