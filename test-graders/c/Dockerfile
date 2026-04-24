FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Non-root user (grading pods runAsNonRoot=true)
RUN useradd -m -u 10001 grader

WORKDIR /home/grader
COPY test_main.c /home/grader/test_main.c
COPY grade.sh /home/grader/grade.sh
RUN chmod 0755 /home/grader/grade.sh \
  && chown -R 10001:10001 /home/grader

USER 10001:10001

ENTRYPOINT ["/home/grader/grade.sh"]

