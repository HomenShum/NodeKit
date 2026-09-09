# Reviewed governance repair: developer journey

A developer receiving NodeKit needs to distinguish an old metadata edit from a newly approved claim. The baseline rejected one old topology-dimensions addition; the reviewed repair retains that raw mutation and visibly acknowledges only its exact historical bytes. A changed claim, directive or acknowledgment remains a failure.

The actual committed verifier reports claimMutations=1, acknowledged=1 and unresolved=0. Reverting commit 0c33b8a in a separate retained checkout restores all 2,695 tracked baseline files and the original expected verifier failure. The working candidate and signed historical events stay unchanged.

The receipt is generated and verified through the existing repository API. It covers only bf6ff6c..0c33b8a, with three material files derived from Git, and keeps its event agent-proposed and human review deferred. Earlier whole-PR workflow authority, canonical promotion, current-package factory proof and broader release gates remain separate.

This local verifier and metadata change has no rendered UI. Earlier consumer screenshots remain bound to their original source; they do not certify this new package identity.
