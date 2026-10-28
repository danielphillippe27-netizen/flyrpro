import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.executescript('''
create table message(guid text,text text,attributedBody blob,is_from_me integer,service text,date integer,handle_id integer);
create table chat(guid text,display_name text);
create table handle(id text);
create table chat_message_join(chat_id integer,message_id integer);
create table chat_handle_join(chat_id integer,handle_id integer);
create table attachment(guid text,filename text,transfer_name text,mime_type text,total_bytes integer);
create table message_attachment_join(message_id integer,attachment_id integer);
insert into chat values('group-1','Our group');
insert into handle values('+19055550101'),('+19055550102');
insert into chat_handle_join values(1,1),(1,2);
insert into attachment values('attachment-1','/missing/photo.jpg','photo.jpg','image/jpeg',100);
insert into message_attachment_join values(3,1);
''')
t='Hello group 🌹'.encode();blob=b'\x04\x0bstreamtypedNSString\x01+'+bytes([len(t)])+t+b'\x86\x84'
for i in range(1,102):
 c.execute('insert into message values(?,?,?,?,?,?,?)',(f'msg-{i}',None if i<3 else 'plain',blob if i==1 else b'unsupported' if i==2 else None,1 if i==1 else 0,'iMessage',800000000000000000,None if i==1 else 1))
 c.execute('insert into chat_message_join values(1,?)',(i,))
c.executescript("""
insert into chat values('matched-person',null),('unknown-person',null);
insert into handle values('+19055550999');
insert into chat_handle_join values(2,1),(3,3);
insert into message values('matched-body','Matched only',null,0,'SMS',800000000000000000,1);
insert into chat_message_join values(2,102);
insert into message values('unknown-body','Must stay local',null,0,'SMS',800000000000000000,3);
insert into chat_message_join values(3,103);
""")
c.commit()
