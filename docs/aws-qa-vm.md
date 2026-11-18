# AWS QA Windows VM — launch configuration (ap-southeast-2)

**Purpose:** guest-agent development + live desktop golden tasks (B0.3 / B6.1), without consuming the developer's 4–5 GB usable local RAM.
**Account:** AWS Free Tier ($100 at signup + up to $100 via activities, 6 months). CLI profile: `phantom`. Region: `ap-southeast-2` (Sydney).

## Recommended configuration

| Setting | Value | Reason |
|---|---|---|
| AMI | **Windows Server 2022 Base** | Includes Desktop Experience (GUI + RDP) and bundled Windows license |
| Instance type | **`t3.large` (2 vCPU / 8 GB RAM)** | t3.medium (4 GB) is too tight for Windows Server + guest agent + Chrome; t3.large fits the $200 credit and can be resized down while stopped |
| Storage | **50 GB gp3** | Default 30 GB is tight for Windows + agent + artifacts |
| Key pair | Create new (`.pem`) | Required to decrypt the Administrator RDP password |
| Security group | Inbound RDP **3389 from your IP only**; outbound all | Never expose 3389 to `0.0.0.0/0` |
| Elastic IP | Optional | Stable public IP across stop/start |
| Region | `ap-southeast-2` | User's project region |

## Cost control

- Windows Server license is **bundled into the hourly instance price** (plus 2 RDS admin licenses, no CALs needed) — it consumes Free Tier credits.
- Approx. `t3.large` Windows ≈ $0.12–0.17/hr in ap-southeast-2 → $200 covers roughly 1,200–1,600 hours (~50–65 days 24/7).
- **Stop the instance (do not terminate) when idle** — you then pay only EBS storage.
- Resize instance type only while stopped.

## Launch checklist (console — new AWS experience)

1. Open **EC2 → Launch Instance** in ap-southeast-2.
2. Name: `phantom-qa-win`. AMI: Windows Server 2022 Base.
3. Instance type: `t3.large` (fallback `t3.medium` if credits are tight).
4. Create/select key pair; download `.pem` to a safe local path (NOT in the repo).
5. Edit security group: RDP 3389 source = **My IP** only.
6. Storage: 50 GB gp3.
7. Launch. Wait ~5 minutes for Windows to initialize (status checks green).
8. Select instance → **Connect → RDP client** → **Get password** → upload `.pem` to decrypt → download RDP file → connect with Remote Desktop.

## Guest-agent setup (after first RDP login)

Windows Server 2022 Base has a GUI, but the agent must run in the **interactive user session**, never as a Session-0 service:
- Enable AutoLogon for the Administrator (or a dedicated QA user) at a **fixed resolution, 100% scaling**.
- Install the built `phantom-guest` and register it as a **per-user logon autostart** (Startup folder / Run key / logon-triggered scheduled task with "run only when user is logged on").
- Install Chrome/Firefox (not included by default) if browser tasks are needed.
- Keep the RDP session **connected**, or move it to the console session (`tscon <id> /dest:console`) before capturing — disconnected sessions produce blank frames.
- Capture order: **Windows.Graphics.Capture → GDI fallback**; DXGI Desktop Duplication only as an optional fast path with fallback.

## CLI equivalent (after AWS CLI install + `aws login` complete)

```powershell
$profile = 'phantom'
$region  = 'ap-southeast-2'

# Find the latest Windows Server 2022 Base AMI (owner = Amazon, 137112412989)
$ami = aws ec2 describe-images --profile $profile --region $region `
  --owners 137112412989 `
  --filters 'Name=name,Values=Windows_Server-2022-English-Full-Base-*' `
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text

# Create key pair (save the .pem outside the repo)
aws ec2 create-key-pair --profile $profile --region $region `
  --key-name phantom-qa --query 'KeyMaterial' --output text | Set-Content phantom-qa.pem

# Security group: RDP from your IP only
$vpc = aws ec2 describe-vpcs --profile $profile --region $region `
  --filters 'Name=isDefault,Values=true' --query 'Vpcs[0].VpcId' --output text
$sg = aws ec2 create-security-group --profile $profile --region $region `
  --group-name phantom-qa-rdp --description 'Phantom QA RDP' --vpc-id $vpc `
  --query 'GroupId' --output text
aws ec2 authorize-security-group-ingress --profile $profile --region $region `
  --group-id $sg --protocol tcp --port 3389 --cidr '<YOUR_PUBLIC_IP>/32'

# Launch
aws ec2 run-instances --profile $profile --region $region `
  --image-id $ami --instance-type t3.large --key-name phantom-qa `
  --security-group-ids $sg --block-device-mappings `
  '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":50,"VolumeType":"gp3"}}]' `
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=phantom-qa-win}]'
```

**Note:** replace `<YOUR_PUBLIC_IP>` with the current public IP. Keep the `.pem` outside version control. Stop the instance when done:
`aws ec2 stop-instances --profile phantom --region ap-southeast-2 --instance-ids <id>`

## Status

- [x] AWS CLI v2.41.0 installed
- [x] `aws login --region ap-southeast-2 --profile phantom` completed by user in browser (account `176592013192`, role `AccountFullAccessRole`)
- [x] `aws sts get-caller-identity --profile phantom` verified
- [x] Agent Toolkit configured via `aws configure agent-toolkit --yes --region us-east-1 --profile phantom`; skills catalog verified via `list-available-skills`
- [x] MCP config patched: `~/.config/opencode/opencode.json` → `aws-mcp.env.AWS_MCP_PROXY_PROFILES = "phantom"`
- [x] New AWS experience rules appended to `AGENTS.md` with idempotent markers; help_level = HIGH
- [ ] EC2 instance launched with the config above — **BLOCKED 2026-11-18**: `RunInstances` returns `Blocked: This account is currently blocked and not recognized as a valid account.` AWS support link: https://support.console.aws.amazon.com/support/home?region=us-east-1#/case/create?issueType=customer-service&serviceCode=account-management&categoryCode=account-verification. The project plan is ACTIVE/FREE with $100 credit and STS works; this is account verification, not credentials or quota.
- [ ] RDP connected, guest agent autostart registered, B0.3 capture proof run
- [x] Resources prepared and reusable once unblocked: key pair `phantom-qa` (`~/.ssh/phantom-qa.pem`), SG `sg-0fc855409019b1a8e` (RDP 3389 from `49.36.71.211/32`), AMI `ami-09339485387465d79`, instance type `m7i-flex.large` (the only Free-Tier-eligible 8 GB x86 type; `t3.large` is NOT eligible on this FREE plan)
- Note: Free-Tier-eligible still consumes credits; stop the instance when idle.
