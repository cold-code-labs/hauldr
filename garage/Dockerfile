# Imagem fininha do Garage: o binário é estático (sem shell), então a config tem
# que existir como arquivo. Copiamos o garage.toml para o caminho padrão. Secrets
# (rpc/admin/metrics) NÃO ficam na imagem — vêm das envs GARAGE_* em runtime.
# Buildar (vs. bind-mount) é o jeito robusto sob Coolify, que reescreve volumes.
FROM dxflrs/garage:v1.0.1
COPY garage.toml /etc/garage.toml
# Entrypoint=null, Cmd=["/garage","server"] herdado da base — nada a sobrescrever.
