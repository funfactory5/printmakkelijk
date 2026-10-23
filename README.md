# PrintMakkelijk — starter voor Ender 3 S1

## Starten
1. Installeer Docker en Docker Compose op de Ubuntu-server.
2. Zet deze map op de server.
3. Open een terminal in deze map en voer uit:
   `docker compose up -d --build`
4. Open `http://IP-VAN-DE-SERVER:8088`

## Wat werkt in deze starter
- Simpele Nederlandse website.
- Zoeklinks naar Printables, Thingiverse, MakerWorld en Yeggi.
- STL uploadformulier.
- Docker-container en health endpoint.

## Belangrijk: G-code slicen is nog niet geactiveerd
De starter maakt bewust nog geen G-code. CuraEngine heeft meer nodig dan alleen een executable: de bijpassende Cura-definities, machine/extruder-profielen, materialen en correcte start-/eind-G-code. Zonder die instellingen zou een gegenereerd bestand onbetrouwbaar kunnen zijn en de printer kunnen beschadigen.

Voor een veilige volgende stap moeten we de juiste Ender 3 S1-definitie en Cura-profielbestanden bundelen, de slicer CLI daarop configureren en echte testprints uitvoeren. De website laat daarom expliciet zien dat slicen nog niet actief is in plaats van een nep-G-codebestand te leveren.

## Modelwebsites
De site opent zoekopdrachten op de oorspronkelijke websites. Dat is bewust: niet iedere website biedt een publieke API of staat toe dat de volledige catalogus wordt gekopieerd. Controleer de licentie van een model voordat je het print of deelt.
