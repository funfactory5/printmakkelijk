# Optional: host PrintMakkelijk on your own server/NAS. Everything (also slicing)
# runs in the visitor's browser, so a plain static web server is enough.
FROM nginx:1.27-alpine
COPY site /usr/share/nginx/html
EXPOSE 80
