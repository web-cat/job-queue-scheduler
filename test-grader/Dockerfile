FROM alpine:3.20

# Create a non-root user because the grading Job sets runAsNonRoot=true.
RUN addgroup -g 10001 -S grader && adduser -u 10001 -S grader -G grader

WORKDIR /home/grader
COPY grade.sh /home/grader/grade.sh
RUN chmod 0755 /home/grader/grade.sh

USER 10001:10001

# The grading job mounts:
# - /grading/submission (read-only)
# - /grading/output (read-write)
# - /tmp (read-write)
ENTRYPOINT ["/home/grader/grade.sh"]

