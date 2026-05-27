from sqlalchemy import create_engine, inspect
from dotenv import load_dotenv
import os

load_dotenv()
url = os.getenv('DATABASE_URL')
print('Using DB URL:', url)
engine = create_engine(url)
ins = inspect(engine)
print('Tables:', ins.get_table_names())
if 'patient_status' in ins.get_table_names():
    cols = [c['name'] for c in ins.get_columns('patient_status')]
    print('patient_status columns:', cols)
else:
    print('patient_status table not found')
