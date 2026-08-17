# Root deployment steps

Run these only after both DNS-only A records resolve to `160.187.111.10`:

- `mail-service.llab.so`
- `mail.llab.so`

Install and validate the prepared Nginx site:

```bash
sudo cp /home/deploy/apps/llab-mail/deploy/nginx-llab-mail.conf /etc/nginx/sites-available/llab-mail
sudo ln -s /etc/nginx/sites-available/llab-mail /etc/nginx/sites-enabled/llab-mail
sudo nginx -t
sudo systemctl reload nginx
```

Issue the dashboard and mail certificates:

```bash
sudo certbot --nginx -d mail.llab.so
sudo certbot certonly --webroot -w /var/www/html -d mail-service.llab.so
```

Install the renewal hook and copy the initial mail certificate into the deploy-owned TLS directory:

```bash
sudo install -m 750 -o root -g root /home/deploy/apps/llab-mail/deploy/certbot-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/llab-mail
sudo /etc/letsencrypt/renewal-hooks/deploy/llab-mail
```

Allow the existing NVM Node binary to bind only privileged ports such as 587 and 995:

```bash
sudo setcap 'cap_net_bind_service=+ep' /home/deploy/.nvm/versions/node/v24.9.0/bin/node
getcap /home/deploy/.nvm/versions/node/v24.9.0/bin/node
```

Reapply the capability after replacing the Node binary. Then return to the `deploy` account to configure `.env` and start PM2.
