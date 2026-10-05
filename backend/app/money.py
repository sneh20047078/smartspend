"""Currency-aware minor-unit helpers used by transaction inputs and summaries."""

SUPPORTED_CURRENCIES: dict[str, int] = {
    "USD": 2,
    "CAD": 2,
    "EUR": 2,
    "GBP": 2,
    "AUD": 2,
    "NZD": 2,
    "JPY": 0,
}


def currency_exponent(currency: str) -> int:
    try:
        return SUPPORTED_CURRENCIES[currency]
    except KeyError as exc:
        raise ValueError("Currency is not currently supported") from exc
