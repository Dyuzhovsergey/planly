# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY migrations ./migrations

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/planly-api ./cmd/api \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/planly-migrate ./cmd/migrate

FROM alpine:3.24 AS runtime

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 planly \
    && adduser -S -D -H -u 10001 -G planly planly

WORKDIR /app

COPY --from=build --chown=planly:planly /out/planly-api /out/planly-migrate ./

USER planly:planly

EXPOSE 8080

CMD ["/app/planly-api"]
