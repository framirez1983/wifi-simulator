FROM nginx:alpine

# Static config + the single-file app
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html

# Stage 7A.1: the RT3D coverage worker and the shared protocol module. The worker
# evaluates the SAME inline script that index.html runs, so these two files carry
# no physics -- they are the transport. They must be in the image, or the coverage
# run cannot start a worker at all.
COPY rt3d-core.js /usr/share/nginx/html/rt3d-core.js
COPY rt3d-worker.js /usr/share/nginx/html/rt3d-worker.js

EXPOSE 80

# Basic container healthcheck (served file responds)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
