-- Beezie Claw labels — one-shot diagnostic (Oct 22 2026), after
-- beezie-claw-candidate.sql showed 0x4cd00e…bc31 is a large shared address
-- ($4–11M a day from ~7,000 senders), not a successor Claw. Dune's labels for
-- it and the other places former Claw payers sent USDC since Oct 20: an
-- exchange (cash-out) or a bridge (the Claw moved chains).
SELECT '0x' || lower(to_hex(address)) AS address, name, category, label_type, source
FROM labels.addresses
WHERE blockchain = 'base'
  AND address IN (0x4cd00e387622c35bddb9b4c962c136462338bc31, 0xac305f7e7fe93a13b110b39ed98be556476d247f, 0x58ad00a56480444cd47629a61bdb754487c293ec, 0x52ab3e76335be886673218212126846268ba8fc3, 0x20120ffce6b22b2d3c76183d1eda0411ba1ed25a, 0x337685fdab40d39bd02028545a4ffa7d287cc3e2, 0x7e07a9148e9149e430c6412b79a675028595ff1f, 0x7d6839415693801e94cdc4a7d732c9a3fdbbd1d7, 0x2612b7e75913630af05fb8f56d5f9bb18e8957cd, 0x7e4d27246b65987065ccb4d469fe59379503cb17, 0x8a021c02ac5233164d7c44d87a344623a49197c5, 0x6824a25f78efd791dca7dad79b7ab46ffb8d776e)
ORDER BY 1, 2
