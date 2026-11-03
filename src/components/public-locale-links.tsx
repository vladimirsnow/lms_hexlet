import { getMessages, localeOptions, type AppLocale } from "@/lib/i18n";

interface PublicLocaleLinksProps {
  locale: AppLocale;
  href: string;
  label?: string;
  passwordChanged?: boolean;
}

export function PublicLocaleLinks({
  locale,
  href,
  label,
  passwordChanged = false,
}: PublicLocaleLinksProps) {
  const messages = getMessages(locale);

  return (
    <nav aria-label={label ?? messages.language} className="footer-language">
      {localeOptions.map((option, index) => {
        const params = new URLSearchParams({ locale: option.value });
        if (passwordChanged) params.set("passwordChanged", "1");
        const returnTo = `${href}?${params.toString()}`;
        const switchParams = new URLSearchParams({ locale: option.value, returnTo });

        return (
          <span className="footer-language-item" key={option.value}>
            {index > 0 ? <i aria-hidden="true" /> : null}
            <a
              aria-current={locale === option.value ? "page" : undefined}
              aria-label={`${option.value.toUpperCase()} — ${option.label}`}
              href={`/locale?${switchParams.toString()}`}
              title={option.label}
            >
              {option.value.toUpperCase()}
            </a>
          </span>
        );
      })}
    </nav>
  );
}
