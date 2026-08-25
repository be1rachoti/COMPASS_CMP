"""Email delivery.

`service.py` is what callers use; `transport.py` is the seam a deployment
replaces; `templates.py` is the words.
"""

from cmp.infrastructure.email.service import EmailService, email_service
from cmp.infrastructure.email.transport import (
    ConsoleEmailTransport,
    EmailTransport,
    NullEmailTransport,
    SmtpEmailTransport,
    build_email_transport,
)

__all__ = [
    "ConsoleEmailTransport",
    "EmailService",
    "EmailTransport",
    "NullEmailTransport",
    "SmtpEmailTransport",
    "build_email_transport",
    "email_service",
]
