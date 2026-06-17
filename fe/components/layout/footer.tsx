function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="#101828" aria-hidden>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="#101828" aria-hidden>
      <path d="M4 4l16 16M20 4L4 20" stroke="#101828" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#101828" strokeWidth="1.8" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="#101828" stroke="none" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="#101828" aria-hidden>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

const links = [
  {
    title: "Products",
    items: ["Personal Finance", "Business Accounts", "Virtual Cards", "International Payments", "Developer APIs"],
  },
  {
    title: "Features",
    items: ["Spending Analytics", "Real-Time Alerts", "Multi-Currency Wallet", "Smart Savings Goals", "Credit Insights"],
  },
  {
    title: "Resources",
    items: ["Getting Started", "Help Center", "Product Updates", "Guides & Tutorials", "Community"],
  },
];

const socials = [
  { label: "Facebook", Icon: FacebookIcon },
  { label: "Twitter", Icon: TwitterIcon },
  { label: "Instagram", Icon: InstagramIcon },
  { label: "LinkedIn", Icon: LinkedInIcon },
];

export function Footer() {
  return (
    <footer className="bg-white px-24 pt-16 pb-8">
      {/* top row */}
      <div className="grid grid-cols-[1fr_1.1fr] gap-20 pb-12 border-b border-[#eaecf0]">
        {/* left */}
        <div>
          <h2 className="text-[33px] font-medium leading-[1.1] tracking-[-0.02em] text-[#101828] md:text-[42px]">
            Let&apos;s Build Your<br />Financial Future.
          </h2>
          {/* email subscribe */}
          <div className="mt-7 flex max-w-[380px] items-center rounded-full bg-white py-1.5 pl-1.5 pr-1.5 ring-1 ring-[#e5e7eb]">
            <span className="grid shrink-0 size-8 place-items-center rounded-full bg-[#0a0e16] text-white"><MailIcon /></span>
            <input
              id="footer-email"
              type="email"
              name="email"
              placeholder="Enter your email"
              aria-label="Email address for newsletter"
              autoComplete="email"
              className="min-w-0 flex-1 bg-transparent pl-2.5 text-[13px] text-[#667085] outline-none placeholder:text-[#b0b8c4]"
            />
            <button className="shrink-0 rounded-full bg-[#0a0e16] px-5 py-2.5 text-[12px] font-medium text-white">
              Subscribe
            </button>
          </div>
          <p className="mt-3 text-[11px] text-[#98a2b3]">
            By subscribing you agree to with our{" "}
            <a href="#" className="underline text-[#667085]">Privacy Policy</a>
          </p>
        </div>

        {/* right: 2×2 contact grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 pt-2">
          <div>
            <h4 className="text-[14px] font-semibold text-[#101828]">Location</h4>
            <p className="mt-2 text-[14px] leading-[1.7] text-[#667085]">Fintech HQ Innovation Park,<br />Global Financial District</p>
          </div>
          <div>
            <h4 className="text-[14px] font-semibold text-[#101828]">Call Us</h4>
            <p className="mt-2 text-[14px] text-[#667085]">+1 (800) 456-7890</p>
          </div>
          <div>
            <h4 className="text-[14px] font-semibold text-[#101828]">Email</h4>
            <p className="mt-2 text-[14px] text-[#667085]">hello@plantora.earth</p>
          </div>
          <div>
            <h4 className="text-[14px] font-semibold text-[#101828]">Working Hours</h4>
            <p className="mt-2 text-[14px] leading-[1.7] text-[#667085]">Mon – Fri: 9:00 AM – 6:00 PM<br />(GMT)</p>
          </div>
        </div>
      </div>

      {/* links row */}
      <div className="grid grid-cols-4 gap-8 py-12 border-b border-[#eaecf0]">
        {links.map(({ title, items }) => (
          <div key={title}>
            <h4 className="text-[13px] font-semibold text-[#101828]">{title}</h4>
            <ul className="mt-4 space-y-3">
              {items.map((item) => (
                <li key={item}>
                  <a href="#" className="text-[13px] text-[#667085] hover:text-[#101828]">{item}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* social */}
        <div>
          <h4 className="text-[13px] font-semibold text-[#101828]">Social Media</h4>
          <div className="mt-4 flex items-center gap-3">
            {socials.map(({ label, Icon }) => (
              <a
                key={label}
                href="#"
                aria-label={label}
                className="grid size-9 place-items-center rounded-[9px] bg-[#f3f4f6] ring-1 ring-[#e5e7eb] hover:bg-[#e9ebee]"
              >
                <Icon />
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* bottom bar */}
      <div className="flex items-center justify-between pt-7 text-[15px] text-[#667085]">
        <span>© 2026 Finora. All rights reserved.</span>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-[#667085]">Terms of Service</a>
          <a href="#" className="hover:text-[#667085]">Privacy Policy</a>
        </div>
      </div>
    </footer>
  );
}
