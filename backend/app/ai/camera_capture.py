import logging

logger = logging.getLogger(__name__)

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None


class CameraCapture:
    def __init__(self, source_url=None):
        self.source_url = source_url
        self.capture = None

    def open(self):
        if cv2 is None:
            logger.warning("OpenCV is not available; camera capture is disabled")
            return False

        source = self.source_url or 0
        self.capture = cv2.VideoCapture(source)
        return bool(self.capture and self.capture.isOpened())

    def read_frame(self):
        if not self.capture:
            return None

        ok, frame = self.capture.read()
        return frame if ok else None

    def close(self):
        if self.capture:
            self.capture.release()
            self.capture = None
