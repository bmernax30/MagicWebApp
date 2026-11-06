# Magic Merna LAN hostname

Prepared for the existing Ubuntu server at **192.168.86.175**, interface **enp2s0f0**, subnet **192.168.86.0/24**. The app must already be running on port **6001**. Avahi and Caddy are already installed on this server.

Run once from your server terminal:

```bash
cd /home/bmernax30/MagicWebApp
sudo bash scripts/setup-lan-name.sh
```

Then open **http://mernamagicapp.local** from a computer or phone on the same LAN. The direct address **http://mernamagicapp.local:6001** also works. Use `http://` explicitly: this route does not need a local HTTPS certificate installed on each phone.

The installer:

- Checks the configured server address, the running app, prerequisites, conflicting names, and port 80.
- Validates the combined Caddy configuration and systemd unit before installation.
- Backs up the existing Caddyfile and any previous managed name unit under `/etc/caddy/magicweb-backup.*`.
- Adds a persistent Avahi name publisher alongside the existing `mulvernabudget.local` publisher. It does not change the machine’s hostname.
- Adds the managed HTTP route and gracefully reloads Caddy, preserving the existing budget HTTPS route. The new listener binds only the server’s LAN IPv4 address and loopback and rejects clients outside the household subnet.
- If UFW is active, adds LAN-only rules for HTTP on TCP 80 and mDNS on UDP 5353.
- Checks that the name resolves to the configured IP and that the HTTP proxy responds.

Running it again updates only its marked Caddy block and managed name unit. It refuses to overwrite unmanaged configuration using the same hostname. Review both files in this folder before running it on a different server or network.

Reserve **192.168.86.175** for the server in your router’s DHCP settings, since both this setup and the existing budget proxy use that address. Do not add a router WAN port-forward: this is a local-network route.

`.local` uses multicast DNS. Devices need mDNS support and must be on the same multicast-capable LAN; guest/client-isolated Wi-Fi or separate VLANs may prevent resolution even when a raw IP works. No per-device hosts-file edits are needed on compatible clients. Older clients that lack mDNS would need an appropriate router DNS setup instead.

## Check the installation

```bash
systemctl status mernamagicapp-name.service --no-pager
avahi-resolve-host-name -4 mernamagicapp.local
curl --noproxy '*' -I http://mernamagicapp.local
```

If a configuration reload fails, the installer prints the backup directory. Restore its `Caddyfile` to `/etc/caddy/Caddyfile` and run `sudo systemctl reload caddy`. Stop/remove the name publisher with `sudo systemctl disable --now mernamagicapp-name.service` if reverting the setup. Do not replace the Caddyfile with the snippet alone; it is intended to be combined with the existing budget configuration.

Implementation references: [Avahi address publication](https://github.com/avahi/avahi/blob/master/man/avahi-publish.1.xml.in), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
