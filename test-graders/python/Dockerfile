FROM python:3.12-slim

# Non-root user (grading pods runAsNonRoot=true)
RUN useradd -m -u 10001 grader

WORKDIR /home/grader
COPY tests /home/grader/tests
COPY grade.sh /home/grader/grade.sh
RUN chmod 0755 /home/grader/grade.sh \
  && chown -R 10001:10001 /home/grader

USER 10001:10001

ENTRYPOINT ["/home/grader/grade.sh"]

