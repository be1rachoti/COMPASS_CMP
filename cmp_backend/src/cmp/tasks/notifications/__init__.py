"""Messages to a data subject about their own record.

Distinct from `tasks.authentication`, which carries the codes somebody is
actively waiting for. These are wanted promptly, not urgently, and route to the
`notifications` queue so they cannot delay a sign-in.

All dispatched optionally: the record they describe is already written, and the
message is a courtesy on top of it.
"""

from cmp.tasks.notifications.consent import send_consent_receipt
from cmp.tasks.notifications.withdrawal import send_withdrawal_confirmation

__all__ = ["send_consent_receipt", "send_withdrawal_confirmation"]
